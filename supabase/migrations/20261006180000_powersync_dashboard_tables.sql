-- ════════════════════════════════════════════════════════════════════════════
-- PowerSync foundation (plan approved 2026-10-06): let PowerSync follow the
-- tables the dashboard reads, so admins' devices can keep a copy.
--
-- WHAT IT DOES
-- powersync_role (created in 20261005210000_powersync_probe.sql — REPLICATION,
-- BYPASSRLS, read-only) may now READ these 16 tables, and the `powersync`
-- publication carries their changes. PowerSync (EU) then keeps a copy of them
-- on its side and hands each device only what powersync/sync-config.yaml
-- allows — for now: active admins and office users only; workers get nothing.
--
--   users, tasks, task_members, reminders, projects, orders,
--   order_delivery_recipients, customers, customer_branches, order_items,
--   products, inventory, payments, phone_attendance_reports, properties,
--   lease_agreements
--
-- No write access, no change to the app's own access rules, no effect on
-- speed (logical replication reads the change log PostgreSQL already writes).
-- Every table here has a primary key, which replication needs.
--
-- WATCH: the database holds its change log until PowerSync has read it. If
-- the PowerSync instance is ever switched off (the free dev instance stops
-- after 7 days without use), the log grows up to max_slot_wal_keep_size
-- (2 GB) and then the slot is dropped — see the rollback's last statement.
--
-- ROLLBACK: supabase/rollbacks/20261006180000_powersync_dashboard_tables.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

grant select on table
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
to powersync_role;

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
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'powersync' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication powersync add table public.%I', t);
    end if;
  end loop;
end $$;
