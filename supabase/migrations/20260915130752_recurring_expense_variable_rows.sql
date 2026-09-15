-- ════════════════════════════════════════════════════════════════════════════
-- Variable-amount recurring bills (סכום משתנה) now materialize like manual ones.
--
-- Until now a variable template was forecast-only: the generator, the
-- "missing occurrences" preview and the backfill all skipped it, so a loan
-- repayment or a tax bill with an ESTIMATE never became a row until someone
-- pressed "סמן כשולם" on a forecast. That made "I moved the start date back
-- and nothing was created" true for exactly the bills the user tried it on.
--
-- Now every period from the start date to today exists as a NOT PAID row that
-- carries the template's estimate (`amount`), waiting for confirmation with the
-- real figure (the mark-paid path accepts an amount and rewrites the row).
-- A variable template whose estimate is 0 still produces nothing — a zero row
-- is useless in the ledger — and stays a forecast until it is paid.
--
-- Standing orders are unchanged (a variable bill can never be auto_paid).
-- Idempotent as before: dedupe is (template, recurrence_key) inside
-- _ensure_recurring_occurrence. Requires 20260720020000 (the helper).
-- ════════════════════════════════════════════════════════════════════════════

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

-- ── Daily generator ─────────────────────────────────────────────────────────
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
    -- A variable bill with no estimate has nothing to write; with one, it is
    -- created as not_paid carrying the estimate (confirmed with the real amount).
    if t.is_variable_amount and coalesce(t.amount, 0) <= 0 then
      continue;
    end if;

    v_anchor := coalesce(t.start_date, t.created_at::date);

    if t.frequency = 'monthly' then
      v_interval := greatest(1, coalesce(t.interval_months, 1));
      for m in
        select gs::date
        from generate_series(
          date_trunc('month', v_anchor),
          date_trunc('month', p_today::timestamp),
          interval '1 month'
        ) gs
      loop
        if (((extract(year from m)::int * 12 + extract(month from m)::int)
             - (extract(year from v_anchor)::int * 12 + extract(month from v_anchor)::int)) % v_interval) <> 0 then
          continue;
        end if;
        occ_date := public.recurring_expense_clamped_date(
          extract(year from m)::int, extract(month from m)::int, t.expense_day_of_month
        );
        occ_key := to_char(m, 'YYYY-MM');
        if t.auto_paid then
          if occ_date > p_today then continue; end if;
        else
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

-- ── "השלמת חיובים חסרים" preview — same rule, so the button agrees with the
--    generator about what is missing ─────────────────────────────────────────
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
  if t.is_active = false then return; end if;
  if t.is_variable_amount and coalesce(t.amount, 0) <= 0 then return; end if;

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
      if (((extract(year from m)::int * 12 + extract(month from m)::int)
           - (extract(year from v_anchor)::int * 12 + extract(month from v_anchor)::int)) % v_interval) <> 0 then
        continue;
      end if;

      occ_date := public.recurring_expense_clamped_date(
        extract(year from m)::int, extract(month from m)::int, t.expense_day_of_month
      );
      occ_key := to_char(m, 'YYYY-MM');

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

grant execute on function public.recurring_expense_missing_occurrences(uuid, date) to authenticated;
