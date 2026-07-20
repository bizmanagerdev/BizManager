-- Auto-paid recurring expenses (bank standing order / הוראת קבע). Such a bill is
-- charged automatically by the bank on its date, so the user shouldn't have to
-- confirm payment: the generator materializes it ALREADY PAID on the expense day.
--
-- auto_paid = true  → generated on the expense day, payment_status 'paid',
--                     paid_date = expense_date, paid_amount = amount (real cash out).
-- auto_paid = false → existing behaviour: generated not_paid, confirmed manually.
-- Variable-amount templates stay forecast-only (skipped) regardless.
--
-- Idempotent; safe to re-run.

alter table public.recurring_expense_templates
  add column if not exists auto_paid boolean not null default false;

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
  gate_date date;
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
    -- Variable-amount templates are forecast-only (materialized on pay).
    if template_row.is_variable_amount then
      continue;
    end if;

    if template_row.frequency = 'monthly' then
      if coalesce(template_row.interval_months, 1) > 1 then
        declare
          v_anchor date := coalesce(template_row.start_date, template_row.created_at::date);
          v_months integer :=
            (extract(year from p_today)::int * 12 + extract(month from p_today)::int)
          - (extract(year from v_anchor)::int * 12 + extract(month from v_anchor)::int);
        begin
          if v_months < 0 or (v_months % template_row.interval_months) <> 0 then
            continue;
          end if;
        end;
      end if;
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

    -- An auto-paid bill is only created once its charge day arrives (it's paid
    -- ON that day); a manual one is created on its create day (then confirmed).
    gate_date := case when template_row.auto_paid then expense_date else create_date end;
    if p_today < gate_date then
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
      payment_status,
      paid_amount,
      paid_date
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
      case when template_row.auto_paid then 'paid' else 'not_paid' end,
      case when template_row.auto_paid then template_row.amount else 0 end,
      case when template_row.auto_paid then expense_date else null end
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
