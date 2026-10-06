-- ════════════════════════════════════════════════════════════════════════════
-- Worker access fixes, part 2 (PowerSync plan, approved 2026-10-06).
-- Admins and office: no change.
--
-- 1. TASKS — every logged-in worker could read ALL tasks (except private ones)
--    and create tasks for anyone. Now a worker reads:
--    - tasks they may open: assigned to them, a member of, or their own
--      private task (task_can_access — the rule the app already uses);
--    - tasks tagged to a vehicle, if they have the vehicles section (the
--      vehicle page lists, edits and deletes those; the edit/delete rules
--      already existed, the read came only from the open rule);
--    and creates tasks assigned to themselves only (the app already forces
--    that). The tasks board, calendar and dashboard already show workers only
--    their own tasks, so nothing they see there changes.
--
-- 2. ORDERS — a worker could change any field of any open order (prices,
--    totals, customer) and its order lines, and add payments to any open
--    order, straight through the API. No worker screen does that: delivery
--    confirmation saves through update_sales_order, which runs with the
--    database's own rights and doesn't use these rules. Dropped.
--
-- 3. PROPERTIES — workers could read every property's full row, purchase
--    price and tax included. Workers' screens (task and shift pickers, task
--    cards, the vehicle page) now read property_directory(): id, name,
--    address and is_active only. The full table is admins and office only.
--
-- 4. BUSINESS SETTINGS — readable by every logged-in user. The only worker
--    use was the audit on/off switch, which the app now reads through
--    get_audit_logging(). Now admins and office only.
--
-- 5. MORNING — settings and issued documents were readable by every
--    logged-in user. A worker's delivery confirmation now issues automatic
--    invoices/receipts (when switched on) with the server's own access, so
--    workers don't need them. Now admins and office only.
--
-- Run this BEFORE deploying the app that reads property_directory(). Until that
-- deploy, workers' property pickers and labels are empty; nothing else they
-- use changes (audit logging is on and Morning auto-issue is off, so the old
-- app's reads falling back to defaults change nothing).
--
-- ROLLBACK: supabase/rollbacks/20261006120000_worker_access_fixes_2.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Tasks -------------------------------------------------------------------
drop policy if exists tasks_select_authenticated on public.tasks;
drop policy if exists tasks_insert_authenticated on public.tasks;

drop policy if exists tasks_worker_select_accessible on public.tasks;
create policy tasks_worker_select_accessible on public.tasks
  for select to authenticated
  using (((select public.current_user_role()) = 'worker'::user_role_enum) and public.task_can_access(id));

drop policy if exists tasks_worker_select_vehicle_tagged on public.tasks;
create policy tasks_worker_select_vehicle_tagged on public.tasks
  for select to authenticated
  using ((exists (select 1 from public.users u
                  where u.auth_user_id = (select auth.uid())
                    and u.role = 'worker'::user_role_enum
                    and u.active = true
                    and coalesce(u.system_access, false) = true
                    and coalesce((u.section_access ->> 'vehicles')::boolean, false)))
         and (exists (select 1 from public.entity_tags et join public.tags t on t.id = et.tag_id
                      where et.entity_type = 'task' and et.entity_id = tasks.id and t.kind = 'vehicle')));

drop policy if exists tasks_worker_insert_own on public.tasks;
create policy tasks_worker_insert_own on public.tasks
  for insert to authenticated
  with check (((select public.current_user_role()) = 'worker'::user_role_enum)
              and assigned_user_id = (select public.current_app_user_id()));

-- 2. Orders ------------------------------------------------------------------
drop policy if exists orders_worker_update_open on public.orders;
drop policy if exists order_items_worker_update on public.order_items;
drop policy if exists payments_worker_insert_order on public.payments;

-- 3. Properties --------------------------------------------------------------
create or replace function public.property_directory()
returns table (id uuid, name text, address text, is_active boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  perform public.require_app_role();
  return query select p.id, p.name, p.address, p.is_active from public.properties p;
end;
$$;
revoke all on function public.property_directory() from public, anon;
grant execute on function public.property_directory() to authenticated, service_role;

drop policy if exists properties_worker_read on public.properties;

-- 4. Business settings -------------------------------------------------------
alter policy business_settings_select on public.business_settings
  using ((select public.current_user_role()) = any (array['admin', 'office']::user_role_enum[]));

-- 5. Morning -----------------------------------------------------------------
drop policy if exists "System users can read morning settings" on public.morning_settings;
drop policy if exists morning_settings_staff_read on public.morning_settings;
create policy morning_settings_staff_read on public.morning_settings
  for select to authenticated
  using ((select public.current_user_role()) = any (array['admin', 'office']::user_role_enum[]));

drop policy if exists "System users can read morning documents" on public.morning_documents;
drop policy if exists morning_documents_staff_read on public.morning_documents;
create policy morning_documents_staff_read on public.morning_documents
  for select to authenticated
  using ((select public.current_user_role()) = any (array['admin', 'office']::user_role_enum[]));
