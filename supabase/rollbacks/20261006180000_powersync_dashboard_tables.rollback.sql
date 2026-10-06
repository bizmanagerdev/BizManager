-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for supabase/migrations/20261006180000_powersync_dashboard_tables.sql
-- PowerSync stops following the 16 dashboard tables and loses read access to
-- them; the publication goes back to the probe table only. Devices keep what
-- they already downloaded until they sign out.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  t text;
begin
  foreach t in array array[
    'users', 'tasks', 'task_members', 'reminders', 'projects', 'orders',
    'order_delivery_recipients', 'customers', 'customer_branches', 'order_items',
    'products', 'inventory', 'payments', 'phone_attendance_reports', 'properties',
    'lease_agreements'
  ] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication powersync drop table public.%I', t);
    end if;
  end loop;
end $$;

revoke select on table
  public.users,
  public.tasks,
  public.task_members,
  public.reminders,
  public.projects,
  public.orders,
  public.order_delivery_recipients,
  public.customers,
  public.customer_branches,
  public.order_items,
  public.products,
  public.inventory,
  public.payments,
  public.phone_attendance_reports,
  public.properties,
  public.lease_agreements
from powersync_role;

-- If PowerSync is being switched off entirely, also run the probe rollback
-- (20261005210000_powersync_probe.rollback.sql) — it drops leftover slots.
