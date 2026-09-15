-- ════════════════════════════════════════════════════════════════════════════
-- The daily generator now back-fills MANUAL recurring bills from their start
-- date, not just the current period.
--
-- Before (20260720020000): only a standing order (auto_paid) walked every month
-- from coalesce(start_date, created_at) to today. A manual bill got the CURRENT
-- period only, so a template whose start date was moved back by three months
-- gained nothing — those months existed only as forecasts on the calendar (and
-- only inside its 3-month lookback), never as rows anyone could confirm. The
-- separate backfill_recurring_expense() (20260809000000) closed that gap, but
-- only when it was called: on template save (silently, best-effort) or from the
-- "השלמת חיובים חסרים" button.
--
-- Now the rule is the same for both kinds and lives in one place: every period
-- from the start date up to today exists as a row. A standing order lands PAID
-- on its charge date (unchanged); a manual bill lands NOT PAID and waits for
-- "סמן כשולם" (unchanged for the current period, new for earlier ones). Editing
-- a start date backwards therefore creates the missing months on the very next
-- page load — the calendar shows them as ממתין/באיחור, exactly like a bill that
-- was generated on its day and never confirmed.
--
-- Variable-amount templates stay forecast-only: a row cannot carry an amount
-- nobody knows yet, so the calendar projects them back to their start date
-- instead (lib/payables.ts lookbackMonths) and "סמן כשולם" materializes each
-- one with the real figure.
--
-- Idempotent: dedupe is the (template, recurrence_key) check inside
-- _ensure_recurring_occurrence, so re-running creates nothing new. Requires
-- 20260720020000 (the helper) — fail loudly here rather than on first run.
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
      -- Every month from the start to today, for BOTH kinds of template.
      for m in
        select gs::date
        from generate_series(
          date_trunc('month', v_anchor),
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
          -- Standing order: only up to the charge day that has actually passed.
          if occ_date > p_today then continue; end if;
        else
          -- Manual: created on its create-day (then confirmed later). For any
          -- past month that day has long passed, so the whole history fills in;
          -- the current month still waits for its create-day.
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
          -- Manual yearly: every year from the start whose create-day has passed.
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
