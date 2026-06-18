-- ════════════════════════════════════════════════════════════════════════════
-- recurring_expenses_require_payment_confirmation
-- Run in the Supabase SQL Editor AFTER create_recurring_expense_templates.sql.
-- Safe to re-run (CREATE OR REPLACE).
--
-- Why: until now generate_recurring_expenses_for_date() inserted expense rows with
-- NO payment_status. On the /financial cash-flow engine an empty status on a row
-- whose expense_date has passed is treated as "posted" (בפועל) — i.e. the money is
-- assumed to have left the account the moment the date arrives, with no human
-- confirmation. That defeats the "did the money really go out?" check.
--
-- What changes: generated rows now come in as payment_status = 'not_paid'. A past
-- recurring expense therefore sits as "pending" (ממתין) — incurred but NOT counted
-- as real cash — until someone marks it שולם. Future-dated rows stay "scheduled"
-- (צפוי) as before. paid_amount / payment_method remain null until confirmed.
--
-- NOTE: this only affects rows generated FROM NOW ON. Existing recurring expense
-- rows (with a null status) keep their current treatment on purpose — flipping
-- months of historical rent/salaries back to "unpaid" would retroactively pull
-- them out of actual cash flow. Backfill separately only if that's wanted.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.generate_recurring_expenses_for_date(
  p_today date default current_date
)
returns integer
language plpgsql
as $$
declare
  template_row public.recurring_expense_templates%rowtype;
  create_date date;
  expense_date date;
  recurrence_key text;
  target_year integer := extract(year from p_today)::integer;
  expense_id uuid;
  created_count integer := 0;
begin
  for template_row in
    select *
    from public.recurring_expense_templates
    where is_active = true
    order by created_at asc
  loop
    if template_row.frequency = 'monthly' then
      recurrence_key := to_char(p_today, 'YYYY-MM');
      create_date := public.recurring_expense_clamped_date(
        target_year,
        extract(month from p_today)::integer,
        template_row.create_day_of_month
      );
      expense_date := public.recurring_expense_clamped_date(
        target_year,
        extract(month from p_today)::integer,
        template_row.expense_day_of_month
      );
    elsif template_row.frequency = 'yearly' then
      recurrence_key := to_char(
        public.recurring_expense_clamped_date(
          target_year,
          template_row.expense_month_of_year,
          template_row.expense_day_of_month
        ),
        'YYYY'
      );
      create_date := public.recurring_expense_clamped_date(
        target_year,
        template_row.create_month_of_year,
        template_row.create_day_of_month
      );
      expense_date := public.recurring_expense_clamped_date(
        target_year,
        template_row.expense_month_of_year,
        template_row.expense_day_of_month
      );
    else
      continue;
    end if;

    if p_today < create_date then
      continue;
    end if;

    if template_row.start_date is not null and expense_date < template_row.start_date then
      continue;
    end if;

    if template_row.end_date is not null and create_date > template_row.end_date then
      continue;
    end if;

    if exists (
      select 1
      from public.expenses e
      where e.recurring_expense_template_id = template_row.id
        and e.recurrence_key = recurrence_key
    ) then
      continue;
    end if;

    insert into public.expenses (
      expense_date,
      amount,
      category,
      description,
      business_domain,
      project_id,
      order_id,
      property_id,
      notes,
      recorded_by,
      recurring_expense_template_id,
      recurrence_key,
      payment_status
    )
    values (
      expense_date,
      template_row.amount,
      template_row.category,
      public.recurring_expense_apply_tokens(
        template_row.description_template,
        recurrence_key,
        expense_date
      ),
      template_row.business_domain,
      template_row.project_id,
      template_row.order_id,
      template_row.property_id,
      public.recurring_expense_apply_tokens(
        template_row.notes_template,
        recurrence_key,
        expense_date
      ),
      template_row.created_by,
      template_row.id,
      recurrence_key,
      -- Wait for human confirmation before counting as real cash out.
      'not_paid'
    )
    returning id into expense_id;

    if template_row.project_id is not null then
      insert into public.project_expenses (
        project_id,
        expense_id,
        included_in_base_price,
        billed_to_customer,
        notes
      )
      values (
        template_row.project_id,
        expense_id,
        template_row.included_in_base_price,
        template_row.billed_to_customer,
        public.recurring_expense_apply_tokens(
          template_row.project_expense_notes_template,
          recurrence_key,
          expense_date
        )
      );
    end if;

    created_count := created_count + 1;
  end loop;

  return created_count;
end;
$$;

grant execute on function public.generate_recurring_expenses_for_date(date) to authenticated;

comment on function public.generate_recurring_expenses_for_date(date) is
  'Creates expense rows from active recurring expense templates once their create date is reached. Generated rows start as payment_status = not_paid and stay "pending" (incurred, not realized cash) until manually confirmed שולם.';
