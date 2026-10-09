-- ROLLBACK for supabase/migrations/20261009100000_israel_today.sql
-- Puts CURRENT_DATE (UTC's date) back in the eight views and the mileage
-- default, then drops public.israel_today(). Switch the phone's copy back too
-- (lib/powersync/local-supabase.ts: today from the UTC date), or the device's
-- money views will differ from the server's between Israeli midnight and
-- 02:00/03:00.

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
begin
  for v in
    select c.oid, c.relname, c.reloptions
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' and c.relname = any (wanted)
  loop
    def := pg_get_viewdef(v.oid);
    execute format(
      'create or replace view public.%I%s as %s',
      v.relname,
      coalesce(' with (' || array_to_string(v.reloptions, ', ') || ')', ''),
      regexp_replace(def, '(public\.)?israel_today\(\)', 'CURRENT_DATE', 'g')
    );
  end loop;
end
$$;

alter table public.vehicle_mileage_readings
  alter column recorded_at set default current_date;

drop function if exists public.israel_today();
