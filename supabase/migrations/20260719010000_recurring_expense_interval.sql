-- Every-N-months recurring expenses ("כל חודשיים" / quarterly / semi-annual).
--
-- Until now a monthly template generated every single month. This adds an
-- interval: interval_months=1 → every month (unchanged), 2 → every 2 months,
-- 3 → quarterly, 6 → semi-annual. Yearly templates are unaffected (they keep
-- their expense_month_of_year). The occurrence months are phased off the
-- template's start_date (or its created_at when no start date is set).
--
-- Idempotent; safe to re-run.

alter table public.recurring_expense_templates
  add column if not exists interval_months integer not null default 1
  check (interval_months between 1 and 12);

-- Recreate the generator with the interval gate on the monthly branch. The rest
-- is identical to 20260719000000_recurring_expense_account.sql (account_id stamp,
-- not_paid status).
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
      -- Interval gate: only generate in occurrence months, counted from the
      -- anchor month (start_date, else the template's created month).
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
