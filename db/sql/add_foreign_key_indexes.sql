-- ════════════════════════════════════════════════════════════════════════════
-- INDEX EVERY FOREIGN KEY
-- Postgres does NOT auto-create indexes for FK columns. Without them, every join
-- that follows the FK, every "child rows for this parent" lookup, and every
-- DELETE of a parent row (which must scan children to enforce the FK) does a full
-- table scan. These indexes speed up the dashboard/financial/customer overview
-- views, list-by-project/order/customer screens, and cascade-checking deletes.
-- Safe + idempotent. Run in the Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

create index if not exists idx_attendance_sessions_project_id on public.attendance_sessions (project_id);
create index if not exists idx_attendance_sessions_property_id on public.attendance_sessions (property_id);
create index if not exists idx_attendance_sessions_user_id on public.attendance_sessions (user_id);
create index if not exists idx_card_statement_rows_project_id on public.card_statement_rows (project_id);
create index if not exists idx_card_statement_rows_property_id on public.card_statement_rows (property_id);
create index if not exists idx_card_statements_document_id on public.card_statements (document_id);
create index if not exists idx_card_statements_imported_by on public.card_statements (imported_by);
create index if not exists idx_communication_logs_created_by on public.communication_logs (created_by);
create index if not exists idx_communication_logs_order_id on public.communication_logs (order_id);
create index if not exists idx_communication_logs_payment_id on public.communication_logs (payment_id);
create index if not exists idx_communication_logs_project_id on public.communication_logs (project_id);
create index if not exists idx_communication_logs_property_id on public.communication_logs (property_id);
create index if not exists idx_contacts_customer_id on public.contacts (customer_id);
create index if not exists idx_document_links_document_id on public.document_links (document_id);
create index if not exists idx_documents_uploaded_by on public.documents (uploaded_by);
create index if not exists idx_expense_merchant_mappings_project_id on public.expense_merchant_mappings (project_id);
create index if not exists idx_expense_merchant_mappings_property_id on public.expense_merchant_mappings (property_id);
create index if not exists idx_expense_merchant_mappings_updated_by on public.expense_merchant_mappings (updated_by);
create index if not exists idx_expenses_order_id on public.expenses (order_id);
create index if not exists idx_expenses_project_id on public.expenses (project_id);
create index if not exists idx_expenses_property_id on public.expenses (property_id);
create index if not exists idx_expenses_recorded_by on public.expenses (recorded_by);
create index if not exists idx_inventory_movements_performed_by on public.inventory_movements (performed_by);
create index if not exists idx_inventory_movements_product_id on public.inventory_movements (product_id);
create index if not exists idx_lease_agreements_customer_id on public.lease_agreements (customer_id);
create index if not exists idx_lease_agreements_document_id on public.lease_agreements (document_id);
create index if not exists idx_lease_agreements_property_id on public.lease_agreements (property_id);
create index if not exists idx_morning_documents_document_id on public.morning_documents (document_id);
create index if not exists idx_morning_documents_issued_by on public.morning_documents (issued_by);
create index if not exists idx_morning_settings_updated_by on public.morning_settings (updated_by);
create index if not exists idx_orders_created_by on public.orders (created_by);
create index if not exists idx_payments_order_id on public.payments (order_id);
create index if not exists idx_payments_project_id on public.payments (project_id);
create index if not exists idx_payments_property_id on public.payments (property_id);
create index if not exists idx_payments_recorded_by on public.payments (recorded_by);
create index if not exists idx_payslips_user_id on public.payslips (user_id);
create index if not exists idx_products_category_id on public.products (category_id);
create index if not exists idx_projects_project_manager_id on public.projects (project_manager_id);
create index if not exists idx_recurring_expense_templates_created_by on public.recurring_expense_templates (created_by);
create index if not exists idx_recurring_task_templates_created_by on public.recurring_task_templates (created_by);
create index if not exists idx_recurring_task_templates_project_id on public.recurring_task_templates (project_id);
create index if not exists idx_recurring_task_templates_property_id on public.recurring_task_templates (property_id);
create index if not exists idx_reminders_communication_log_id on public.reminders (communication_log_id);
create index if not exists idx_reminders_created_by on public.reminders (created_by);
create index if not exists idx_reminders_order_id on public.reminders (order_id);
create index if not exists idx_reminders_payment_id on public.reminders (payment_id);
create index if not exists idx_reminders_property_id on public.reminders (property_id);
create index if not exists idx_reminders_updated_by on public.reminders (updated_by);
create index if not exists idx_salary_agreements_user_id on public.salary_agreements (user_id);
create index if not exists idx_task_comments_author_id on public.task_comments (author_id);
create index if not exists idx_tasks_property_id on public.tasks (property_id);
create index if not exists idx_worker_payment_allocations_attendance_session_id on public.worker_payment_allocations (attendance_session_id);
create index if not exists idx_worker_payment_allocations_payslip_id on public.worker_payment_allocations (payslip_id);
create index if not exists idx_worker_payment_allocations_worker_payment_id on public.worker_payment_allocations (worker_payment_id);
create index if not exists idx_worker_payments_recorded_by on public.worker_payments (recorded_by);
create index if not exists idx_worker_payments_user_id on public.worker_payments (user_id);

analyze;
