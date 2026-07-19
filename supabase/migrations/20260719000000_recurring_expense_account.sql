-- Account on recurring expense templates.
--
-- Every money movement in the app now records which account (bank/cash) it moves
-- THROUGH (see lib/accounts.ts + create_accounts.sql, which already added
-- expenses.account_id). Recurring bills were the one hole: the template had no
-- account, so generated expense rows landed account-less. This adds account_id to
-- the template and stamps it onto every expense the generator creates.
--
-- Idempotent; safe to re-run.

alter table public.recurring_expense_templates
  add column if not exists account_id uuid null
  references public.accounts (id) on delete set null;

create index if not exists recurring_expense_templates_account_idx
  on public.recurring_expense_templates (account_id);

-- Recreate the generator so newly created expenses carry the template's account.
-- Body is identical to db/sql/create_recurring_expense_templates.sql except for the
-- added account_id column in the expenses insert.
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
      account_id,
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
      template_row.account_id,
      public.recurring_expense_apply_tokens(
        template_row.notes_template,
        recurrence_key,
        expense_date
      ),
      template_row.created_by,
      template_row.id,
      recurrence_key,
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
