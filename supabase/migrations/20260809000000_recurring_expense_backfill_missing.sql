-- ════════════════════════════════════════════════════════════════════════════
-- "השלמת חיובים חסרים" — materialize the occurrences a template SHOULD have
-- produced but never did.
--
-- WHY THERE ARE GAPS: generate_recurring_expenses_for_date() back-fills every
-- month from the anchor for AUTO-PAID (הוראת קבע) templates, but for a MANUAL
-- template it only ever creates the CURRENT period (20260720020000). So a manual
-- monthly bill with start_date in January, first generated in July, is simply
-- missing February–June — and nothing in the app ever creates them, because the
-- generator only runs for today.
--
-- These two functions close that hole WITHOUT changing the daily generator:
--   recurring_expense_missing_occurrences() — read-only preview: which periods
--     are missing (so the UI can say exactly what it's about to create).
--   backfill_recurring_expense()            — creates them, reusing the same
--     _ensure_recurring_occurrence() insert path as the generator, so a
--     back-filled row is byte-identical to a generated one.
--
-- Only the PAST is filled (expense_date <= p_through). Future periods stay
-- forecasts. Inactive and variable-amount templates produce nothing, mirroring
-- the generator. Idempotent: dedupe is the template+recurrence_key check inside
-- _ensure_recurring_occurrence, so re-running creates nothing new.
-- ════════════════════════════════════════════════════════════════════════════

-- Hard dependency: the shared insert path added in 20260720020000. Fail loudly
-- here rather than with "function does not exist" the first time someone clicks.
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_ensure_recurring_occurrence'
  ) then
    raise exception 'Run 20260720020000_recurring_expense_backfill_auto_paid.sql first (missing public._ensure_recurring_occurrence).';
  end if;
end $$;

create or replace function public.recurring_expense_missing_occurrences(
  p_template_id uuid,
  p_through date default current_date
)
returns table (recurrence_key text, expense_date date, would_be_paid boolean)
language plpgsql
as $$
declare
  t public.recurring_expense_templates%rowtype;
  v_anchor date;
  v_interval integer;
  occ_date date;
  occ_key text;
  m date;
  y integer;
begin
  select * into t from public.recurring_expense_templates where id = p_template_id;
  if not found then return; end if;
  -- Same exclusions as the generator: nothing is owed by a template that is off
  -- or whose amount is only known at pay time.
  if t.is_active = false or t.is_variable_amount then return; end if;

  v_anchor := coalesce(t.start_date, t.created_at::date);

  if t.frequency = 'monthly' then
    v_interval := greatest(1, coalesce(t.interval_months, 1));
    for m in
      select gs::date
      from generate_series(
        date_trunc('month', v_anchor),
        date_trunc('month', p_through::timestamp),
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

      -- Past only — a future charge is still just a forecast.
      if occ_date > p_through then continue; end if;
      if t.start_date is not null and occ_date < t.start_date then continue; end if;
      if t.end_date is not null and occ_date > t.end_date then continue; end if;
      if exists (
        select 1 from public.expenses e
        where e.recurring_expense_template_id = t.id and e.recurrence_key = occ_key
      ) then
        continue;
      end if;

      recurrence_key := occ_key;
      expense_date := occ_date;
      would_be_paid := t.auto_paid;
      return next;
    end loop;

  elsif t.frequency = 'yearly' then
    for y in extract(year from v_anchor)::int .. extract(year from p_through)::int loop
      occ_date := public.recurring_expense_clamped_date(y, t.expense_month_of_year, t.expense_day_of_month);
      occ_key := to_char(occ_date, 'YYYY');

      if occ_date > p_through then continue; end if;
      if t.start_date is not null and occ_date < t.start_date then continue; end if;
      if t.end_date is not null and occ_date > t.end_date then continue; end if;
      if exists (
        select 1 from public.expenses e
        where e.recurring_expense_template_id = t.id and e.recurrence_key = occ_key
      ) then
        continue;
      end if;

      recurrence_key := occ_key;
      expense_date := occ_date;
      would_be_paid := t.auto_paid;
      return next;
    end loop;
  end if;
end;
$$;

create or replace function public.backfill_recurring_expense(
  p_template_id uuid,
  p_through date default current_date
)
returns integer
language plpgsql
as $$
declare
  t public.recurring_expense_templates%rowtype;
  occ record;
  v_created integer := 0;
begin
  select * into t from public.recurring_expense_templates where id = p_template_id;
  if not found then return 0; end if;

  for occ in
    select * from public.recurring_expense_missing_occurrences(p_template_id, p_through)
  loop
    -- Same insert path as the daily generator, including the auto-paid rule:
    -- a standing order lands already paid on its charge date; a manual bill
    -- lands not_paid and waits for confirmation.
    if public._ensure_recurring_occurrence(t, occ.recurrence_key, occ.expense_date, t.auto_paid) then
      v_created := v_created + 1;
    end if;
  end loop;

  return v_created;
end;
$$;

grant execute on function public.recurring_expense_missing_occurrences(uuid, date) to authenticated;
grant execute on function public.backfill_recurring_expense(uuid, date) to authenticated;
