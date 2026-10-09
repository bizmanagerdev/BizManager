-- "Today" in the database follows Israel's calendar, not UTC's (owner's OK,
-- 2026-10-09). The database clock runs on UTC, so CURRENT_DATE stays on
-- yesterday from Israeli midnight until 02:00 (winter) / 03:00 (summer). The
-- app already takes today from Israel's calendar (israelDateKey(), commit
-- c0342a3); these views were the last place still on UTC's.
--
-- public.israel_today() is Israel's date right now. It replaces CURRENT_DATE in
-- the eight views that used it — nothing else in them changes:
--   order_financials_view, order_overview_view, customer_overview_view,
--   project_financials_view       — money "due by today" counts as overdue
--   worker_debt_items_view        — a payslip not yet due; this month
--   current_salary_agreements_view — the agreement in force today
--   salary_center_worker_overview_view, operations_dashboard_view — this month
-- task_overview_view is left as it is: it compares due_date (a timestamp) with
-- now(), two instants, with no calendar day involved.
--
-- Each view is rebuilt from its own live definition (pg_get_viewdef) with only
-- CURRENT_DATE swapped, keeping its options (security_invoker), grants and
-- columns; a view that no longer holds CURRENT_DATE stops the migration. The
-- phone's copy of the four views it works out itself
-- (lib/powersync/local-supabase.ts) takes today from israelDateKey() to match
-- (commit 79187d7).
--
-- vehicle_mileage_readings.recorded_at defaults to Israel's date too (the app
-- already sends it — this is the fallback).

create or replace function public.israel_today()
returns date
language sql
stable
parallel safe
set search_path = ''
as $$
  select (pg_catalog.now() at time zone 'Asia/Jerusalem')::date
$$;

comment on function public.israel_today() is
  'Today''s date on Israel''s calendar (Asia/Jerusalem). Use instead of CURRENT_DATE, which is UTC''s.';

grant execute on function public.israel_today() to anon, authenticated, service_role;

do $$
declare
  wanted constant text[] := array[
    'current_salary_agreements_view',
    'customer_overview_view',
    'operations_dashboard_view',
    'order_financials_view',
    'order_overview_view',
    'project_financials_view',
    'salary_center_worker_overview_view',
    'worker_debt_items_view'
  ];
  v record;
  def text;
  found integer := 0;
begin
  for v in
    select c.oid, c.relname, c.reloptions
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' and c.relname = any (wanted)
  loop
    def := pg_get_viewdef(v.oid);
    if position('CURRENT_DATE' in def) = 0 then
      raise exception 'israel_today: % no longer uses CURRENT_DATE — check it by hand', v.relname;
    end if;
    execute format(
      'create or replace view public.%I%s as %s',
      v.relname,
      coalesce(' with (' || array_to_string(v.reloptions, ', ') || ')', ''),
      replace(def, 'CURRENT_DATE', 'public.israel_today()')
    );
    found := found + 1;
  end loop;
  if found <> array_length(wanted, 1) then
    raise exception 'israel_today: expected % views, found %', array_length(wanted, 1), found;
  end if;
end
$$;

alter table public.vehicle_mileage_readings
  alter column recorded_at set default public.israel_today();
