-- ════════════════════════════════════════════════════════════════════════════
-- PERFORMANCE ONLY. Zero change to who can read or write what.
--
-- WHY THIS IS NEEDED
-- /projects, the financial pages and /documents are slow even when the server
-- is warm. Measured 2026-10-05 in pg_stat_statements, for the logged-in
-- (authenticated) role:
--
--   project_dashboard_view (the /projects list)   391–797 ms per call
--   session_effective_payment_view                 698 ms (max 7.3 s)
--   audit_logs (activity feed / digest)            451 ms, ~3,000 calls
--   collections_view                               175 ms
--   customer_overview_view                         269 ms
--   project_financials_view                        103–117 ms
--
-- The same project_dashboard_view query run without RLS takes 5.8 ms. The data
-- is small (62 projects, ~400 attendance sessions); the time is the security
-- policies.
--
-- THE CAUSE
-- These 101 policies call the role helpers bare:
--
--   using (is_admin())
--   using (current_user_role() = 'office')
--   using (user_id = current_app_user_id())
--
-- Each helper is a SECURITY DEFINER function that looks the caller up in
-- `users`. Written bare, Postgres calls it again for EVERY row it checks, in
-- every table a view touches — and the financial views touch up to 13 tables
-- (attendance, payslips, salary agreements, payroll periods, worker payments,
-- tasks, users, customers…), often in nested loops. Hundreds of rows × several
-- policies × several helpers adds up to most of a second.
--
-- THE FIX
-- Wrap each call in a scalar subquery: `(select public.is_admin())`. Postgres
-- then evaluates it ONCE per query (an "InitPlan") and reuses the answer for
-- every row. The helpers are STABLE and take no arguments — their answer cannot
-- change between rows of one query — so the result is identical; only the
-- number of evaluations changes. This is Supabase's documented remedy, and the
-- same fix this repo already applied to projects/expenses/payments/
-- project_expenses' USING clauses (20260902103000, 20260902113000,
-- 20260902160000). Those migrations missed the tables below and every
-- WITH CHECK clause.
--
-- WHAT EXACTLY CHANGES
-- `alter policy` with only USING / WITH CHECK keeps each policy's name,
-- command, roles and permissive/restrictive kind as they are. Every expression
-- below is the live definition (verified md5-identical to production on
-- 2026-10-05) with only these substitutions:
--   is_admin()               → (select public.is_admin())
--   current_user_role()      → (select public.current_user_role())
--   current_app_user_id()    → (select public.current_app_user_id())
--   task_current_user_id()   → (select public.task_current_user_id())
--   task_is_office_admin()   → (select public.task_is_office_admin())
--   auth.uid()               → (select auth.uid())   (document_categories only)
-- Functions that take a row value — task_can_access(task_id),
-- order_status_is_open(status), is_payroll_worker(user_id),
-- order_is_worker_deliverable(order_id) — depend on the row and stay as they are.
--
-- Not touched: storage.objects (owned by Supabase's storage role, and not on
-- any page-load path).
--
-- Each statement takes a brief lock on its table; the whole file runs in well
-- under a second. Idempotent: running it twice leaves the same policies.
--
-- ROLLBACK: supabase/rollbacks/20261005120000_rls_initplan_role_helpers.rollback.sql
-- puts every expression back exactly as it was.
--
-- CHECK AFTERWARDS — should return no rows:
--   select tablename, policyname from pg_policies
--   where schemaname = 'public'
--     and (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
--         ~ '(is_admin|current_user_role|current_app_user_id|task_current_user_id|task_is_office_admin|auth\.uid)\(\)(?! AS )';
-- ════════════════════════════════════════════════════════════════════════════

-- attendance_sessions
alter policy attendance_admin_full on public.attendance_sessions
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy attendance_office_full on public.attendance_sessions
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy attendance_worker_select_own on public.attendance_sessions
  using ((user_id = (select public.current_app_user_id())));

-- audit_logs
alter policy admin_read_logs on public.audit_logs
  using ((select public.is_admin()));

-- contacts
alter policy customers_admin_full on public.contacts
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy customers_office_full on public.contacts
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

-- customer_branches
alter policy customer_branches_office_manage on public.customer_branches
  using (((select public.current_user_role()) = ANY (ARRAY['admin'::user_role_enum, 'office'::user_role_enum])))
  with check (((select public.current_user_role()) = ANY (ARRAY['admin'::user_role_enum, 'office'::user_role_enum])));

alter policy customer_branches_worker_select on public.customer_branches
  using (((select public.current_user_role()) = 'worker'::user_role_enum));

-- customers
alter policy customers_admin_full on public.customers
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy customers_office_full on public.customers
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy customers_worker_select on public.customers
  using (((select public.current_user_role()) = 'worker'::user_role_enum));

alter policy customers_worker_update_delivery_location on public.customers
  using (((select public.current_user_role()) = 'worker'::user_role_enum))
  with check (((select public.current_user_role()) = 'worker'::user_role_enum));

-- document_categories
alter policy "Admin manage document categories" on public.document_categories
  using ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.auth_user_id = (select auth.uid())) AND (u.role = 'admin'::user_role_enum) AND (u.active = true)))))
  with check ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.auth_user_id = (select auth.uid())) AND (u.role = 'admin'::user_role_enum) AND (u.active = true)))));

alter policy "Read document categories" on public.document_categories
  using ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.auth_user_id = (select auth.uid())) AND (u.role = ANY (ARRAY['admin'::user_role_enum, 'office'::user_role_enum, 'worker'::user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));

-- document_links
alter policy document_links_admin_full on public.document_links
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy document_links_office_full on public.document_links
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy document_links_worker_insert on public.document_links
  with check ((((select public.current_user_role()) = 'worker'::user_role_enum) AND (entity_type = 'order'::text)));

alter policy document_links_worker_select_order on public.document_links
  using ((((select public.current_user_role()) = 'worker'::user_role_enum) AND (entity_type = 'order'::text)));

-- documents
alter policy documents_admin_full on public.documents
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy documents_office_full on public.documents
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy documents_worker_insert on public.documents
  with check ((((select public.current_user_role()) = 'worker'::user_role_enum) AND (uploaded_by = ( SELECT auth.uid() AS uid))));

alter policy documents_worker_select_order on public.documents
  using ((((select public.current_user_role()) = 'worker'::user_role_enum) AND (EXISTS ( SELECT 1
   FROM document_links dl
  WHERE ((dl.document_id = documents.id) AND (dl.entity_type = 'order'::text))))));

-- expenses
alter policy admin_full_access on public.expenses
  with check ((select public.is_admin()));

alter policy expenses_office_full on public.expenses
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

-- hourly_salary_overrides
alter policy hourly_salary_overrides_admin_full on public.hourly_salary_overrides
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy hourly_salary_overrides_office_full on public.hourly_salary_overrides
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy hourly_salary_overrides_view_own on public.hourly_salary_overrides
  using ((user_id = (select public.current_app_user_id())));

-- inventory
alter policy inventory_admin_full on public.inventory
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy inventory_office_full on public.inventory
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

-- inventory_movements
alter policy inventory_movements_admin_full on public.inventory_movements
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy inventory_movements_office_full on public.inventory_movements
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

-- lease_agreements
alter policy lease_agreements_admin_full on public.lease_agreements
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy lease_agreements_office_full on public.lease_agreements
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

-- order_items
alter policy admin_full_access_order_items on public.order_items
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy office_full_order_items on public.order_items
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy order_items_worker_select on public.order_items
  using ((((select public.current_user_role()) = 'worker'::user_role_enum) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND order_status_is_open(o.status))))));

alter policy order_items_worker_update on public.order_items
  using ((((select public.current_user_role()) = 'worker'::user_role_enum) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND order_status_is_open(o.status))))))
  with check ((((select public.current_user_role()) = 'worker'::user_role_enum) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE (o.id = order_items.order_id)))));

-- orders
alter policy admin_full_access_orders on public.orders
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy office_full_orders on public.orders
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy orders_worker_select_open on public.orders
  using ((((select public.current_user_role()) = 'worker'::user_role_enum) AND order_status_is_open(status)));

alter policy orders_worker_update_open on public.orders
  using ((((select public.current_user_role()) = 'worker'::user_role_enum) AND order_status_is_open(status)))
  with check ((((select public.current_user_role()) = 'worker'::user_role_enum) AND (order_status_is_open(status) OR (status = ANY (ARRAY['delivered'::text, 'completed'::text, 'סופקה'::text, 'הושלמה'::text])))));

-- payments
alter policy admin_full_access_payments on public.payments
  with check ((select public.is_admin()));

alter policy payments_office_full on public.payments
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy payments_worker_insert_order on public.payments
  with check ((((select public.current_user_role()) = 'worker'::user_role_enum) AND (order_id IS NOT NULL) AND order_is_worker_deliverable(order_id)));

alter policy worker_insert_payment on public.payments
  with check (((select public.current_user_role()) = 'worker'::user_role_enum));

-- payroll_periods
alter policy payroll_periods_admin_full on public.payroll_periods
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy payroll_periods_office_manage on public.payroll_periods
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy payroll_periods_worker_view_own on public.payroll_periods
  using ((EXISTS ( SELECT 1
   FROM payslips p
  WHERE ((p.payroll_period_id = payroll_periods.id) AND (p.user_id = (select public.current_app_user_id()))))));

-- payslip_items
alter policy payslip_items_admin_full on public.payslip_items
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy payslip_items_office_full on public.payslip_items
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy payslip_items_view_own on public.payslip_items
  using ((EXISTS ( SELECT 1
   FROM payslips p
  WHERE ((p.id = payslip_items.payslip_id) AND (p.user_id = (select public.current_app_user_id()))))));

alter policy payslip_items_worker_add_own_bonus on public.payslip_items
  with check (((user_id = (select public.current_app_user_id())) AND (created_by = (select public.current_app_user_id())) AND (item_type = 'bonus'::text) AND (amount > (0)::numeric) AND (payslip_id IS NULL)));

alter policy payslip_items_worker_delete_own_unattached on public.payslip_items
  using (((user_id = (select public.current_app_user_id())) AND (item_type = 'bonus'::text) AND (payslip_id IS NULL)));

-- payslips
alter policy "Office can manage payslips" on public.payslips
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy payslips_admin_full on public.payslips
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy payslips_view_own on public.payslips
  using ((user_id = (select public.current_app_user_id())));

-- phone_attendance_reports
alter policy phone_attendance_worker_close on public.phone_attendance_reports
  using ((((select public.current_user_role()) = 'worker'::user_role_enum) AND (status = 'open'::text) AND is_payroll_worker(user_id)))
  with check ((((select public.current_user_role()) = 'worker'::user_role_enum) AND is_payroll_worker(user_id) AND (((status = 'open'::text) AND (clock_out IS NULL)) OR ((status = 'pending_review'::text) AND (clock_out IS NOT NULL) AND (clock_out > clock_in)))));

-- This policy and phone_attendance_worker_insert_own below still exist in
-- production but were dropped by 20260811010000, so a database built from the
-- migrations (CI, local) doesn't have them and a bare alter fails. Alter them
-- only where they exist.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'phone_attendance_reports'
      and policyname = 'phone_attendance_worker_close_own'
  ) then
    alter policy phone_attendance_worker_close_own on public.phone_attendance_reports
      using (((user_id = (select public.current_app_user_id())) AND (status = 'open'::text) AND (source = 'app'::text)))
      with check (((user_id = (select public.current_app_user_id())) AND (status = 'pending_review'::text) AND (source = 'app'::text)));
  end if;
end $$;

alter policy phone_attendance_worker_edit_pending_own on public.phone_attendance_reports
  using (((user_id = (select public.current_app_user_id())) AND (status = 'pending_review'::text)))
  with check (((user_id = (select public.current_app_user_id())) AND (status = 'pending_review'::text)));

alter policy phone_attendance_worker_insert on public.phone_attendance_reports
  with check ((((select public.current_user_role()) = 'worker'::user_role_enum) AND is_payroll_worker(user_id) AND (reported_by = (select public.current_app_user_id())) AND (status = ANY (ARRAY['open'::text, 'pending_review'::text])) AND (source = 'app'::text) AND (((status = 'open'::text) AND (clock_out IS NULL)) OR ((status = 'pending_review'::text) AND (clock_out IS NOT NULL) AND (clock_out > clock_in)))));

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'phone_attendance_reports'
      and policyname = 'phone_attendance_worker_insert_own'
  ) then
    alter policy phone_attendance_worker_insert_own on public.phone_attendance_reports
      with check (((user_id = (select public.current_app_user_id())) AND (status = 'open'::text) AND (source = 'app'::text)));
  end if;
end $$;

alter policy phone_attendance_worker_select_open_coworkers on public.phone_attendance_reports
  using ((((select public.current_user_role()) = 'worker'::user_role_enum) AND (status = 'open'::text) AND is_payroll_worker(user_id)));

alter policy phone_attendance_worker_select_own on public.phone_attendance_reports
  using ((user_id = (select public.current_app_user_id())));

-- product_categories
alter policy product_categories_admin_full on public.product_categories
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy product_categories_office_full on public.product_categories
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy products_worker_select on public.product_categories
  using (((select public.current_user_role()) = 'worker'::user_role_enum));

-- products
alter policy products_admin_full on public.products
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy products_office_full on public.products
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy products_worker_select on public.products
  using (((select public.current_user_role()) = 'worker'::user_role_enum));

-- project_expenses
alter policy admin_full_access on public.project_expenses
  with check ((select public.is_admin()));

alter policy project_expenses_office_full on public.project_expenses
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

-- projects
alter policy admin_full_access on public.projects
  with check ((select public.is_admin()));

alter policy office_insert_projects on public.projects
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy office_update_projects on public.projects
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

-- properties
alter policy properties_admin_full on public.properties
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy properties_office_full on public.properties
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy properties_worker_read on public.properties
  using (((select public.current_user_role()) = 'worker'::user_role_enum));

-- push_alert_config
alter policy push_alert_config_admin_full on public.push_alert_config
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- reminders
alter policy reminders_self_insert on public.reminders
  with check ((created_by = (select public.task_current_user_id())));

alter policy reminders_self_or_task_select on public.reminders
  using (((created_by = (select public.task_current_user_id())) OR ((task_id IS NOT NULL) AND task_can_access(task_id))));

alter policy reminders_self_or_task_update on public.reminders
  using (((created_by = (select public.task_current_user_id())) OR ((task_id IS NOT NULL) AND task_can_access(task_id))));

-- salary_agreements
alter policy "Office can read salary agreements" on public.salary_agreements
  using (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy salary_admin_full on public.salary_agreements
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy salary_view_own on public.salary_agreements
  using ((user_id = (select public.current_app_user_id())));

-- task_comments
alter policy task_comments_delete on public.task_comments
  using (((author_id = (select public.task_current_user_id())) OR (select public.task_is_office_admin())));

alter policy task_comments_insert on public.task_comments
  with check ((task_can_access(task_id) AND (author_id = (select public.task_current_user_id()))));

alter policy task_comments_update on public.task_comments
  using (((author_id = (select public.task_current_user_id())) OR (select public.task_is_office_admin())));

-- task_members
alter policy task_members_select on public.task_members
  using (((user_id = (select public.task_current_user_id())) OR task_can_access(task_id)));

-- tasks
alter policy admin_full_access on public.tasks
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy office_full_access on public.tasks
  using (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy tasks_privacy_restrict on public.tasks
  using (((COALESCE(is_private, false) = false) OR (private_owner_id = (select public.task_current_user_id()))))
  with check (((COALESCE(is_private, false) = false) OR (private_owner_id = (select public.task_current_user_id()))));

-- user_sessions
alter policy user_sessions_staff_read on public.user_sessions
  using (((select public.is_admin()) OR ((select public.current_user_role()) = 'office'::user_role_enum)));

-- users
alter policy admin_full_access on public.users
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy office_can_view_users on public.users
  using (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy only_admin_update_users on public.users
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy users_worker_view_coworkers on public.users
  using ((((select public.current_user_role()) = 'worker'::user_role_enum) AND (active = true) AND (role = ANY (ARRAY['worker'::user_role_enum, 'worker_no_access'::user_role_enum]))));

-- worker_absences
alter policy worker_absences_select_own on public.worker_absences
  using ((user_id = (select public.current_app_user_id())));

-- worker_payment_allocations
alter policy "Office can manage worker payment allocations" on public.worker_payment_allocations
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy worker_payment_allocations_view_own on public.worker_payment_allocations
  using ((EXISTS ( SELECT 1
   FROM worker_payments wp
  WHERE ((wp.id = worker_payment_allocations.worker_payment_id) AND (wp.user_id = (select public.current_app_user_id()))))));

-- worker_payments
alter policy "Office can manage worker payments" on public.worker_payments
  using (((select public.current_user_role()) = 'office'::user_role_enum))
  with check (((select public.current_user_role()) = 'office'::user_role_enum));

alter policy worker_payments_view_own on public.worker_payments
  using ((user_id = (select public.current_app_user_id())));
