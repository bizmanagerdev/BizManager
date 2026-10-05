-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for supabase/migrations/20261005120000_rls_initplan_role_helpers.sql
--
-- Puts all 101 policy expressions back exactly as they were before that
-- migration (the live definitions, verified md5-identical to production on
-- 2026-10-05). Run it in the SQL editor ONLY if that migration causes a
-- problem. This folder is not replayed by CI or "supabase db push".
-- ════════════════════════════════════════════════════════════════════════════

-- attendance_sessions
alter policy attendance_admin_full on public.attendance_sessions
  using (is_admin())
  with check (is_admin());

alter policy attendance_office_full on public.attendance_sessions
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

alter policy attendance_worker_select_own on public.attendance_sessions
  using ((user_id = current_app_user_id()));

-- audit_logs
alter policy admin_read_logs on public.audit_logs
  using (is_admin());

-- contacts
alter policy customers_admin_full on public.contacts
  using (is_admin())
  with check (is_admin());

alter policy customers_office_full on public.contacts
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

-- customer_branches
alter policy customer_branches_office_manage on public.customer_branches
  using ((current_user_role() = ANY (ARRAY['admin'::user_role_enum, 'office'::user_role_enum])))
  with check ((current_user_role() = ANY (ARRAY['admin'::user_role_enum, 'office'::user_role_enum])));

alter policy customer_branches_worker_select on public.customer_branches
  using ((current_user_role() = 'worker'::user_role_enum));

-- customers
alter policy customers_admin_full on public.customers
  using (is_admin())
  with check (is_admin());

alter policy customers_office_full on public.customers
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

alter policy customers_worker_select on public.customers
  using ((current_user_role() = 'worker'::user_role_enum));

alter policy customers_worker_update_delivery_location on public.customers
  using ((current_user_role() = 'worker'::user_role_enum))
  with check ((current_user_role() = 'worker'::user_role_enum));

-- document_categories
alter policy "Admin manage document categories" on public.document_categories
  using ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.auth_user_id = auth.uid()) AND (u.role = 'admin'::user_role_enum) AND (u.active = true)))))
  with check ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.auth_user_id = auth.uid()) AND (u.role = 'admin'::user_role_enum) AND (u.active = true)))));

alter policy "Read document categories" on public.document_categories
  using ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.auth_user_id = auth.uid()) AND (u.role = ANY (ARRAY['admin'::user_role_enum, 'office'::user_role_enum, 'worker'::user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));

-- document_links
alter policy document_links_admin_full on public.document_links
  using (is_admin())
  with check (is_admin());

alter policy document_links_office_full on public.document_links
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

alter policy document_links_worker_insert on public.document_links
  with check (((current_user_role() = 'worker'::user_role_enum) AND (entity_type = 'order'::text)));

alter policy document_links_worker_select_order on public.document_links
  using (((current_user_role() = 'worker'::user_role_enum) AND (entity_type = 'order'::text)));

-- documents
alter policy documents_admin_full on public.documents
  using (is_admin())
  with check (is_admin());

alter policy documents_office_full on public.documents
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

alter policy documents_worker_insert on public.documents
  with check (((current_user_role() = 'worker'::user_role_enum) AND (uploaded_by = ( SELECT auth.uid() AS uid))));

alter policy documents_worker_select_order on public.documents
  using (((current_user_role() = 'worker'::user_role_enum) AND (EXISTS ( SELECT 1
   FROM document_links dl
  WHERE ((dl.document_id = documents.id) AND (dl.entity_type = 'order'::text))))));

-- expenses
alter policy admin_full_access on public.expenses
  with check (is_admin());

alter policy expenses_office_full on public.expenses
  with check ((current_user_role() = 'office'::user_role_enum));

-- hourly_salary_overrides
alter policy hourly_salary_overrides_admin_full on public.hourly_salary_overrides
  using (is_admin())
  with check (is_admin());

alter policy hourly_salary_overrides_office_full on public.hourly_salary_overrides
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

alter policy hourly_salary_overrides_view_own on public.hourly_salary_overrides
  using ((user_id = current_app_user_id()));

-- inventory
alter policy inventory_admin_full on public.inventory
  using (is_admin())
  with check (is_admin());

alter policy inventory_office_full on public.inventory
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

-- inventory_movements
alter policy inventory_movements_admin_full on public.inventory_movements
  using (is_admin())
  with check (is_admin());

alter policy inventory_movements_office_full on public.inventory_movements
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

-- lease_agreements
alter policy lease_agreements_admin_full on public.lease_agreements
  using (is_admin())
  with check (is_admin());

alter policy lease_agreements_office_full on public.lease_agreements
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

-- order_items
alter policy admin_full_access_order_items on public.order_items
  using (is_admin())
  with check (is_admin());

alter policy office_full_order_items on public.order_items
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

alter policy order_items_worker_select on public.order_items
  using (((current_user_role() = 'worker'::user_role_enum) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND order_status_is_open(o.status))))));

alter policy order_items_worker_update on public.order_items
  using (((current_user_role() = 'worker'::user_role_enum) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND order_status_is_open(o.status))))))
  with check (((current_user_role() = 'worker'::user_role_enum) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE (o.id = order_items.order_id)))));

-- orders
alter policy admin_full_access_orders on public.orders
  using (is_admin())
  with check (is_admin());

alter policy office_full_orders on public.orders
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

alter policy orders_worker_select_open on public.orders
  using (((current_user_role() = 'worker'::user_role_enum) AND order_status_is_open(status)));

alter policy orders_worker_update_open on public.orders
  using (((current_user_role() = 'worker'::user_role_enum) AND order_status_is_open(status)))
  with check (((current_user_role() = 'worker'::user_role_enum) AND (order_status_is_open(status) OR (status = ANY (ARRAY['delivered'::text, 'completed'::text, 'סופקה'::text, 'הושלמה'::text])))));

-- payments
alter policy admin_full_access_payments on public.payments
  with check (is_admin());

alter policy payments_office_full on public.payments
  with check ((current_user_role() = 'office'::user_role_enum));

alter policy payments_worker_insert_order on public.payments
  with check (((current_user_role() = 'worker'::user_role_enum) AND (order_id IS NOT NULL) AND order_is_worker_deliverable(order_id)));

alter policy worker_insert_payment on public.payments
  with check ((current_user_role() = 'worker'::user_role_enum));

-- payroll_periods
alter policy payroll_periods_admin_full on public.payroll_periods
  using (is_admin())
  with check (is_admin());

alter policy payroll_periods_office_manage on public.payroll_periods
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

alter policy payroll_periods_worker_view_own on public.payroll_periods
  using ((EXISTS ( SELECT 1
   FROM payslips p
  WHERE ((p.payroll_period_id = payroll_periods.id) AND (p.user_id = current_app_user_id())))));

-- payslip_items
alter policy payslip_items_admin_full on public.payslip_items
  using (is_admin())
  with check (is_admin());

alter policy payslip_items_office_full on public.payslip_items
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

alter policy payslip_items_view_own on public.payslip_items
  using ((EXISTS ( SELECT 1
   FROM payslips p
  WHERE ((p.id = payslip_items.payslip_id) AND (p.user_id = current_app_user_id())))));

alter policy payslip_items_worker_add_own_bonus on public.payslip_items
  with check (((user_id = current_app_user_id()) AND (created_by = current_app_user_id()) AND (item_type = 'bonus'::text) AND (amount > (0)::numeric) AND (payslip_id IS NULL)));

alter policy payslip_items_worker_delete_own_unattached on public.payslip_items
  using (((user_id = current_app_user_id()) AND (item_type = 'bonus'::text) AND (payslip_id IS NULL)));

-- payslips
alter policy "Office can manage payslips" on public.payslips
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

alter policy payslips_admin_full on public.payslips
  using (is_admin())
  with check (is_admin());

alter policy payslips_view_own on public.payslips
  using ((user_id = current_app_user_id()));

-- phone_attendance_reports
alter policy phone_attendance_worker_close on public.phone_attendance_reports
  using (((current_user_role() = 'worker'::user_role_enum) AND (status = 'open'::text) AND is_payroll_worker(user_id)))
  with check (((current_user_role() = 'worker'::user_role_enum) AND is_payroll_worker(user_id) AND (((status = 'open'::text) AND (clock_out IS NULL)) OR ((status = 'pending_review'::text) AND (clock_out IS NOT NULL) AND (clock_out > clock_in)))));

alter policy phone_attendance_worker_close_own on public.phone_attendance_reports
  using (((user_id = current_app_user_id()) AND (status = 'open'::text) AND (source = 'app'::text)))
  with check (((user_id = current_app_user_id()) AND (status = 'pending_review'::text) AND (source = 'app'::text)));

alter policy phone_attendance_worker_edit_pending_own on public.phone_attendance_reports
  using (((user_id = current_app_user_id()) AND (status = 'pending_review'::text)))
  with check (((user_id = current_app_user_id()) AND (status = 'pending_review'::text)));

alter policy phone_attendance_worker_insert on public.phone_attendance_reports
  with check (((current_user_role() = 'worker'::user_role_enum) AND is_payroll_worker(user_id) AND (reported_by = current_app_user_id()) AND (status = ANY (ARRAY['open'::text, 'pending_review'::text])) AND (source = 'app'::text) AND (((status = 'open'::text) AND (clock_out IS NULL)) OR ((status = 'pending_review'::text) AND (clock_out IS NOT NULL) AND (clock_out > clock_in)))));

alter policy phone_attendance_worker_insert_own on public.phone_attendance_reports
  with check (((user_id = current_app_user_id()) AND (status = 'open'::text) AND (source = 'app'::text)));

alter policy phone_attendance_worker_select_open_coworkers on public.phone_attendance_reports
  using (((current_user_role() = 'worker'::user_role_enum) AND (status = 'open'::text) AND is_payroll_worker(user_id)));

alter policy phone_attendance_worker_select_own on public.phone_attendance_reports
  using ((user_id = current_app_user_id()));

-- product_categories
alter policy product_categories_admin_full on public.product_categories
  using (is_admin())
  with check (is_admin());

alter policy product_categories_office_full on public.product_categories
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

alter policy products_worker_select on public.product_categories
  using ((current_user_role() = 'worker'::user_role_enum));

-- products
alter policy products_admin_full on public.products
  using (is_admin())
  with check (is_admin());

alter policy products_office_full on public.products
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

alter policy products_worker_select on public.products
  using ((current_user_role() = 'worker'::user_role_enum));

-- project_expenses
alter policy admin_full_access on public.project_expenses
  with check (is_admin());

alter policy project_expenses_office_full on public.project_expenses
  with check ((current_user_role() = 'office'::user_role_enum));

-- projects
alter policy admin_full_access on public.projects
  with check (is_admin());

alter policy office_insert_projects on public.projects
  with check ((current_user_role() = 'office'::user_role_enum));

alter policy office_update_projects on public.projects
  with check ((current_user_role() = 'office'::user_role_enum));

-- properties
alter policy properties_admin_full on public.properties
  using (is_admin())
  with check (is_admin());

alter policy properties_office_full on public.properties
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

alter policy properties_worker_read on public.properties
  using ((current_user_role() = 'worker'::user_role_enum));

-- push_alert_config
alter policy push_alert_config_admin_full on public.push_alert_config
  using (is_admin())
  with check (is_admin());

-- reminders
alter policy reminders_self_insert on public.reminders
  with check ((created_by = task_current_user_id()));

alter policy reminders_self_or_task_select on public.reminders
  using (((created_by = task_current_user_id()) OR ((task_id IS NOT NULL) AND task_can_access(task_id))));

alter policy reminders_self_or_task_update on public.reminders
  using (((created_by = task_current_user_id()) OR ((task_id IS NOT NULL) AND task_can_access(task_id))));

-- salary_agreements
alter policy "Office can read salary agreements" on public.salary_agreements
  using ((current_user_role() = 'office'::user_role_enum));

alter policy salary_admin_full on public.salary_agreements
  using (is_admin())
  with check (is_admin());

alter policy salary_view_own on public.salary_agreements
  using ((user_id = current_app_user_id()));

-- task_comments
alter policy task_comments_delete on public.task_comments
  using (((author_id = task_current_user_id()) OR task_is_office_admin()));

alter policy task_comments_insert on public.task_comments
  with check ((task_can_access(task_id) AND (author_id = task_current_user_id())));

alter policy task_comments_update on public.task_comments
  using (((author_id = task_current_user_id()) OR task_is_office_admin()));

-- task_members
alter policy task_members_select on public.task_members
  using (((user_id = task_current_user_id()) OR task_can_access(task_id)));

-- tasks
alter policy admin_full_access on public.tasks
  using (is_admin())
  with check (is_admin());

alter policy office_full_access on public.tasks
  using ((current_user_role() = 'office'::user_role_enum));

alter policy tasks_privacy_restrict on public.tasks
  using (((COALESCE(is_private, false) = false) OR (private_owner_id = task_current_user_id())))
  with check (((COALESCE(is_private, false) = false) OR (private_owner_id = task_current_user_id())));

-- user_sessions
alter policy user_sessions_staff_read on public.user_sessions
  using ((is_admin() OR (current_user_role() = 'office'::user_role_enum)));

-- users
alter policy admin_full_access on public.users
  using (is_admin())
  with check (is_admin());

alter policy office_can_view_users on public.users
  using ((current_user_role() = 'office'::user_role_enum));

alter policy only_admin_update_users on public.users
  using (is_admin())
  with check (is_admin());

alter policy users_worker_view_coworkers on public.users
  using (((current_user_role() = 'worker'::user_role_enum) AND (active = true) AND (role = ANY (ARRAY['worker'::user_role_enum, 'worker_no_access'::user_role_enum]))));

-- worker_absences
alter policy worker_absences_select_own on public.worker_absences
  using ((user_id = current_app_user_id()));

-- worker_payment_allocations
alter policy "Office can manage worker payment allocations" on public.worker_payment_allocations
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

alter policy worker_payment_allocations_view_own on public.worker_payment_allocations
  using ((EXISTS ( SELECT 1
   FROM worker_payments wp
  WHERE ((wp.id = worker_payment_allocations.worker_payment_id) AND (wp.user_id = current_app_user_id())))));

-- worker_payments
alter policy "Office can manage worker payments" on public.worker_payments
  using ((current_user_role() = 'office'::user_role_enum))
  with check ((current_user_role() = 'office'::user_role_enum));

alter policy worker_payments_view_own on public.worker_payments
  using ((user_id = current_app_user_id()));
