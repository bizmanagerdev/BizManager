-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for supabase/migrations/20261006120000_worker_access_fixes_2.sql
-- Puts every rule back exactly as it was on 2026-10-06 (read from production).
-- property_directory() stays: the app reads it, and it shows nothing new.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Tasks
drop policy if exists tasks_worker_select_accessible on public.tasks;
drop policy if exists tasks_worker_select_vehicle_tagged on public.tasks;
drop policy if exists tasks_worker_insert_own on public.tasks;
drop policy if exists tasks_select_authenticated on public.tasks;
create policy tasks_select_authenticated on public.tasks for select to authenticated using (true);
drop policy if exists tasks_insert_authenticated on public.tasks;
create policy tasks_insert_authenticated on public.tasks for insert to authenticated with check (true);

-- 2. Orders
drop policy if exists orders_worker_update_open on public.orders;
create policy orders_worker_update_open on public.orders for update to authenticated
  using ((((select current_user_role()) = 'worker'::user_role_enum) and order_status_is_open(status)))
  with check ((((select current_user_role()) = 'worker'::user_role_enum) and (order_status_is_open(status) or (status = any (array['delivered'::text, 'completed'::text, 'סופקה'::text, 'הושלמה'::text])))));
drop policy if exists order_items_worker_update on public.order_items;
create policy order_items_worker_update on public.order_items for update to authenticated
  using ((((select current_user_role()) = 'worker'::user_role_enum) and (exists (select 1 from orders o where ((o.id = order_items.order_id) and order_status_is_open(o.status))))))
  with check ((((select current_user_role()) = 'worker'::user_role_enum) and (exists (select 1 from orders o where (o.id = order_items.order_id)))));
drop policy if exists payments_worker_insert_order on public.payments;
create policy payments_worker_insert_order on public.payments for insert to authenticated
  with check ((((select current_user_role()) = 'worker'::user_role_enum) and (order_id is not null) and order_is_worker_deliverable(order_id)));

-- 3. Properties
drop policy if exists properties_worker_read on public.properties;
create policy properties_worker_read on public.properties for select to public
  using (((select current_user_role()) = 'worker'::user_role_enum));

-- 4. Business settings
alter policy business_settings_select on public.business_settings using (true);

-- 5. Morning
drop policy if exists morning_settings_staff_read on public.morning_settings;
drop policy if exists "System users can read morning settings" on public.morning_settings;
create policy "System users can read morning settings" on public.morning_settings for select to authenticated
  using ((exists (select 1 from users u where ((u.auth_user_id = (select auth.uid())) and (u.active = true) and (coalesce(u.system_access, false) = true)))));
drop policy if exists morning_documents_staff_read on public.morning_documents;
drop policy if exists "System users can read morning documents" on public.morning_documents;
create policy "System users can read morning documents" on public.morning_documents for select to authenticated
  using ((exists (select 1 from users u where ((u.auth_user_id = (select auth.uid())) and (u.active = true) and (coalesce(u.system_access, false) = true)))));
