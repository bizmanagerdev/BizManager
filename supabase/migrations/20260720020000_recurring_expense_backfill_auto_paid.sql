-- Back-fill past occurrences for auto-paid (הוראת קבע) recurring expenses.
--
-- If you add a standing-order bill with a start date 2 months ago, those two
-- months were really charged by the bank already — so the generator should create
-- them now as PAID expenses on their original dates, not just the current month.
--
-- Manual (non-auto) templates are unchanged: only the current period is created
-- (past-due ones surface as forecasts, not materialized rows). Variable templates
-- stay forecast-only.
--
-- Idempotent (recurrence_key uniqueness per template+period). Safe to re-run.

-- Helper: create ONE occurrence if it doesn't exist yet. Returns true if it did.
create or replace function public._ensure_recurring_occurrence(
  t public.recurring_expense_templates,
  p_key text,
  p_expense_date date,
  p_paid boolean
)
returns boolean
language plpgsql
as $$
declare
  v_expense_id uuid;
begin
  if t.start_date is not null and p_expense_date < t.start_date then
    return false;
  end if;
  if t.end_date is not null and p_expense_date > t.end_date then
    return false;
  end if;
  if exists (
    select 1 from public.expenses e
    where e.recurring_expense_template_id = t.id and e.recurrence_key = p_key
  ) then
    return false;
  end if;

  insert into public.expenses (
    expense_date, amount, category, description, business_domain,
    project_id, order_id, property_id, account_id, notes, recorded_by,
    recurring_expense_template_id, recurrence_key, payment_status, paid_amount, paid_date
  )
  values (
    p_expense_date, t.amount, t.category,
    public.recurring_expense_apply_tokens(t.description_template, p_key, p_expense_date),
    -- The template stores the domain as text; expenses.business_domain is an enum,
    -- and a text VARIABLE won't implicitly cast to it inside PL/pgSQL (only bare
    -- string literals do — which is why the old inline generator silently failed).
    coalesce(t.business_domain, 'general_business')::public.business_domain_enum, t.project_id, t.order_id, t.property_id, t.account_id,
    public.recurring_expense_apply_tokens(t.notes_template, p_key, p_expense_date),
    t.created_by, t.id, p_key,
    case when p_paid then 'paid' else 'not_paid' end,
    case when p_paid then t.amount else 0 end,
    case when p_paid then p_expense_date else null end
  )
  returning id into v_expense_id;

  if t.project_id is not null then
    insert into public.project_expenses (project_id, expense_id, included_in_base_price, billed_to_customer, notes)
    values (
      t.project_id, v_expense_id, t.included_in_base_price, t.billed_to_customer,
      public.recurring_expense_apply_tokens(t.project_expense_notes_template, p_key, p_expense_date)
    );
  end if;

  return true;
end;
$$;

create or replace function public.generate_recurring_expenses_for_date(
  p_today date default current_date
)
returns integer
language plpgsql
as $$
declare
  t public.recurring_expense_templates%rowtype;
  v_anchor date;
  v_interval integer;
  occ_date date;
  occ_key text;
  created_count integer := 0;
  m date;
  y integer;
begin
  for t in
    select * from public.recurring_expense_templates
    where is_active = true
    order by created_at asc
  loop
    -- Variable-amount templates are forecast-only (materialized on pay).
    if t.is_variable_amount then
      continue;
    end if;

    v_anchor := coalesce(t.start_date, t.created_at::date);

    if t.frequency = 'monthly' then
      v_interval := greatest(1, coalesce(t.interval_months, 1));
      -- Auto-paid → back-fill every month from the start; manual → current month only.
      for m in
        select gs::date
        from generate_series(
          case when t.auto_paid then date_trunc('month', v_anchor) else date_trunc('month', p_today::timestamp) end,
          date_trunc('month', p_today::timestamp),
          interval '1 month'
        ) gs
      loop
        -- Keep only months on the interval phase (every N months from the anchor).
        if (((extract(year from m)::int * 12 + extract(month from m)::int)
             - (extract(year from v_anchor)::int * 12 + extract(month from v_anchor)::int)) % v_interval) <> 0 then
          continue;
        end if;
        occ_date := public.recurring_expense_clamped_date(
          extract(year from m)::int, extract(month from m)::int, t.expense_day_of_month
        );
        occ_key := to_char(m, 'YYYY-MM');
        if t.auto_paid then
          -- Only up to the charge day that has actually passed.
          if occ_date > p_today then continue; end if;
        else
          -- Manual: created on its create-day (then confirmed later).
          if p_today < public.recurring_expense_clamped_date(
               extract(year from m)::int, extract(month from m)::int, t.create_day_of_month) then
            continue;
          end if;
        end if;
        if public._ensure_recurring_occurrence(t, occ_key, occ_date, t.auto_paid) then
          created_count := created_count + 1;
        end if;
      end loop;

    elsif t.frequency = 'yearly' then
      for y in extract(year from v_anchor)::int .. extract(year from p_today)::int loop
        occ_date := public.recurring_expense_clamped_date(y, t.expense_month_of_year, t.expense_day_of_month);
        occ_key := to_char(occ_date, 'YYYY');
        if t.auto_paid then
          if occ_date > p_today then continue; end if;
        else
          -- Manual yearly: only the current year, on/after its create-day.
          if y <> extract(year from p_today)::int then continue; end if;
          if p_today < public.recurring_expense_clamped_date(y, t.create_month_of_year, t.create_day_of_month) then
            continue;
          end if;
        end if;
        if public._ensure_recurring_occurrence(t, occ_key, occ_date, t.auto_paid) then
          created_count := created_count + 1;
        end if;
      end loop;
    else
      continue;
    end if;
  end loop;

  return created_count;
end;
$$;

grant execute on function public.generate_recurring_expenses_for_date(date) to authenticated;
