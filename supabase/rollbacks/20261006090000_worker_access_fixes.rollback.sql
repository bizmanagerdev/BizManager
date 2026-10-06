-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for supabase/migrations/20261006090000_worker_access_fixes.sql
-- Puts every rule back exactly as it was on 2026-10-06 (read from production).
-- The app code that now writes users.id into uploaded_by / recorded_by keeps
-- working either way for admins and the 2 workers whose ids match.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Payments
drop policy if exists worker_insert_payment on public.payments;
create policy worker_insert_payment on public.payments for insert to public
  with check (((select current_user_role()) = 'worker'::user_role_enum));

-- 2. Customers
drop trigger if exists customers_worker_fields_guard on public.customers;
drop function if exists public.customers_worker_fields_guard();
alter policy customers_worker_update_delivery_location on public.customers
  using (((select current_user_role()) = 'worker'::user_role_enum))
  with check (((select current_user_role()) = 'worker'::user_role_enum));
drop function if exists public.customer_is_worker_deliverable(uuid);

-- 3. Wrong user id
alter policy documents_worker_insert on public.documents
  with check ((((select current_user_role()) = 'worker'::user_role_enum) and (uploaded_by = (select auth.uid()))));
alter policy worker_insert_expenses on public.expenses
  with check ((recorded_by = (select auth.uid())));
alter policy expenses_worker_select_own on public.expenses
  using ((recorded_by = (select auth.uid())));
alter policy worker_update_own_expenses on public.expenses
  using ((recorded_by = (select auth.uid())));
alter policy worker_insert_project_expenses on public.project_expenses
  with check ((exists (select 1 from tasks t where ((t.project_id = project_expenses.project_id) and (t.assigned_user_id = (select auth.uid()))))));
alter policy worker_view_assigned_projects on public.projects
  using ((exists (select 1 from tasks t where ((t.project_id = projects.id) and (t.assigned_user_id = (select auth.uid()))))));
alter policy worker_view_assigned_tasks on public.tasks
  using ((assigned_user_id = (select auth.uid())));

-- 4. Task attachments
alter policy document_links_worker_insert on public.document_links
  with check ((((select current_user_role()) = 'worker'::user_role_enum) and (entity_type = 'order'::text)));

-- 5. Finance tables
drop policy if exists "System users can read recurring expense templates" on public.recurring_expense_templates;
create policy "System users can read recurring expense templates" on public.recurring_expense_templates
  for select to authenticated
  using ((exists (select 1 from users u where ((u.auth_user_id = (select auth.uid())) and (u.active = true) and (coalesce(u.system_access, false) = true)))));
drop policy if exists "System users can read card settlement confirmations" on public.card_settlement_confirmations;
create policy "System users can read card settlement confirmations" on public.card_settlement_confirmations
  for select to authenticated
  using ((exists (select 1 from users u where ((u.auth_user_id = (select auth.uid())) and (u.active = true) and (coalesce(u.system_access, false) = true)))));
drop policy if exists "System users can read outflow source settings" on public.outflow_source_settings;
create policy "System users can read outflow source settings" on public.outflow_source_settings
  for select to authenticated
  using ((exists (select 1 from users u where ((u.auth_user_id = (select auth.uid())) and (u.active = true) and (coalesce(u.system_access, false) = true)))));
