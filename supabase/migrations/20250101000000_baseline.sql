-- ════════════════════════════════════════════════════════════════════════════
-- BASELINE SCHEMA — captured from production 2026-06-29 (public schema).
-- Assembled from catalog dumps via the dashboard SQL editor (the laptop network
-- filter blocks the Supabase CLI / direct DB port, so `supabase db pull` couldn't
-- run; this is the equivalent, captured by hand).
--
-- Dependency order: extensions → enums → tables → constraints → indexes →
-- functions → views → triggers → RLS → policies → grants.
--
-- STATUS (2026-06-29):
--   CAPTURED from prod: extensions, enums, tables, constraints (PK/FK/CHECK).
--   PENDING (large — chat capture truncates; finish via `supabase db pull` from an
--   unfiltered machine, or lift from db/sql/): the index tail, functions/RPCs,
--   views, triggers, RLS-enable + policies, grants.
-- ════════════════════════════════════════════════════════════════════════════

-- ===== extensions =====
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create extension if not exists pg_stat_statements;
create extension if not exists supabase_vault;

-- ===== enums =====
create type public.business_domain_enum as enum ('logistics_projects', 'sales', 'property_management', 'general_business', 'home', 'charity', 'spaceit');
create type public.payment_status_enum as enum ('pending', 'cleared', 'rejected');
create type public.project_status_enum as enum ('quote', 'planned', 'active', 'on_hold', 'completed', 'cancelled');
create type public.project_type_enum as enum ('logistics', 'construction', 'moving', 'other', 'home');
create type public.task_priority_enum as enum ('low', 'medium', 'high', 'urgent');
create type public.task_status_enum as enum ('todo', 'in_progress', 'blocked', 'done', 'cancelled');
create type public.user_role_enum as enum ('admin', 'office', 'worker', 'worker_no_access');

-- ===== tables =====

create table if not exists public.accounts (
  id uuid not null default gen_random_uuid(),
  name text not null,
  kind text not null default 'bank'::text,
  opening_balance numeric not null default 0,
  opening_date date not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  notes text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.attendance_sessions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  clock_in timestamp with time zone not null,
  clock_out timestamp with time zone,
  worked_minutes integer,
  notes text,
  business_domain business_domain_enum not null default 'general_business'::business_domain_enum,
  project_id uuid,
  property_id uuid,
  labor_cost numeric(12,2),
  is_billable_to_customer boolean not null default false,
  bill_to_customer_amount numeric(12,2),
  billing_status text not null default 'not_billable'::text
);

create table if not exists public.audit_logs (
  id uuid not null default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  user_role text,
  created_at timestamp with time zone default now()
);

create table if not exists public.business_settings (
  id boolean not null default true,
  vat_rate numeric not null default 0.18,
  updated_at timestamp with time zone default now(),
  updated_by uuid,
  audit_logging_enabled boolean not null default true
);

create table if not exists public.card_statement_rows (
  id uuid not null default gen_random_uuid(),
  statement_id uuid not null,
  expense_id uuid,
  expense_date date,
  transaction_date date,
  amount numeric,
  description text,
  category text,
  business_domain text,
  project_id uuid,
  property_id uuid,
  notes text,
  created_at timestamp with time zone not null default now(),
  assignment_raw text,
  include boolean not null default true,
  income_payment_id uuid,
  row_index integer
);

create table if not exists public.card_statements (
  id uuid not null default gen_random_uuid(),
  file_name text not null default ''::text,
  source text not null default 'excel'::text,
  document_id uuid,
  storage_key text,
  total_rows integer not null default 0,
  created_count integer not null default 0,
  imported_by uuid,
  created_at timestamp with time zone not null default now(),
  marked_done boolean not null default false
);

create table if not exists public.communication_logs (
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  user_id uuid not null,
  direction text not null,
  content text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  channel text not null default 'phone'::text,
  category text not null default 'collection'::text,
  order_id uuid,
  project_id uuid,
  property_id uuid,
  payment_id uuid,
  created_by uuid
);

create table if not exists public.contacts (
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  full_name text not null,
  role text,
  phone text,
  email text,
  whatsapp text,
  is_primary boolean not null default false,
  active boolean not null default true,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.customers (
  id uuid not null default gen_random_uuid(),
  name text not null,
  name_for_invoice text,
  registration_number text,
  phone text not null,
  email text,
  address text,
  active boolean not null default true,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  whatsapp text,
  morning_client_id text,
  morning_synced_at timestamp with time zone,
  morning_match_status text,
  morning_last_sync_error text,
  requires_prepayment boolean not null default false
);

create table if not exists public.document_links (
  id uuid not null default gen_random_uuid(),
  document_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.documents (
  id uuid not null default gen_random_uuid(),
  document_type text not null,
  title text not null,
  file_name text not null,
  storage_key text,
  uploaded_by uuid not null,
  uploaded_at timestamp with time zone not null default now(),
  notes text,
  business_domain text not null default 'general_business'::text
);

create table if not exists public.entity_tags (
  id uuid not null default gen_random_uuid(),
  tag_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  ref_year integer,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.expense_merchant_mappings (
  id uuid not null default gen_random_uuid(),
  merchant_key text not null,
  business_domain text not null,
  project_id uuid,
  property_id uuid,
  use_count integer not null default 1,
  last_used_at timestamp with time zone not null default now(),
  updated_by uuid,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.expenses (
  id uuid not null default gen_random_uuid(),
  expense_date timestamp with time zone not null default now(),
  amount numeric not null,
  category text not null,
  description text,
  business_domain business_domain_enum not null,
  notes text,
  recorded_by uuid not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  project_id uuid,
  order_id uuid,
  property_id uuid,
  recurring_expense_template_id uuid,
  recurrence_key text,
  payment_status text,
  paid_amount numeric(12,2),
  payment_method text,
  transaction_date date,
  account_id uuid
);

create table if not exists public.hourly_salary_overrides (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  start_time timestamp with time zone not null,
  end_time timestamp with time zone,
  override_hourly_rate numeric(12,2) not null,
  reason text,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.idempotency_keys (
  key text not null,
  user_id uuid not null,
  endpoint text,
  status text not null default 'processing'::text,
  response_status integer,
  response_body jsonb,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.inventory (
  product_id uuid not null,
  quantity_on_hand numeric not null default 0,
  quantity_reserved numeric not null default 0,
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.inventory_movements (
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  movement_type text not null,
  quantity numeric not null,
  source_type text not null,
  source_id uuid,
  performed_by uuid,
  notes text,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.lease_agreements (
  id uuid not null default gen_random_uuid(),
  property_id uuid not null,
  customer_id uuid not null,
  start_date date not null,
  end_date date,
  monthly_rent_amount numeric not null,
  document_id uuid,
  status text not null default 'active'::text,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.loan_repayments (
  id uuid not null default gen_random_uuid(),
  loan_id uuid not null,
  repayment_date date not null,
  amount numeric not null default 0,
  interest_amount numeric not null default 0,
  method text,
  notes text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  account_id uuid
);

create table if not exists public.loans (
  id uuid not null default gen_random_uuid(),
  direction text not null default 'taken'::text,
  lender text,
  borrower text,
  loan_date date not null,
  loan_method text,
  repayment_method text,
  documentation text,
  amount numeric not null default 0,
  due_date date,
  interest_amount numeric not null default 0,
  business_domain text not null default 'general_business'::text,
  counterparty_customer_id uuid,
  status text not null default 'active'::text,
  notes text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  account_id uuid
);

create table if not exists public.morning_documents (
  id uuid not null default gen_random_uuid(),
  morning_document_id text not null,
  morning_document_number text,
  document_type integer not null,
  document_type_label text not null,
  status text not null default 'created'::text,
  customer_id uuid,
  order_id uuid,
  project_id uuid,
  payment_id uuid,
  document_id uuid,
  morning_client_id text,
  amount numeric,
  currency text not null default 'ILS'::text,
  morning_url text,
  pdf_url text,
  source_payload jsonb,
  response_payload jsonb,
  issued_by uuid,
  issued_at timestamp with time zone default now(),
  closed_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  notes text
);

create table if not exists public.morning_settings (
  id boolean not null default true,
  auto_invoice_on_order_completion boolean not null default false,
  invoice_type_on_completion smallint not null default 305,
  auto_receipt_on_payment boolean not null default false,
  receipt_type_on_payment smallint not null default 400,
  updated_at timestamp with time zone not null default now(),
  updated_by uuid
);

create table if not exists public.order_items (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  product_id uuid not null,
  quantity_ordered numeric not null,
  quantity_delivered numeric not null default 0,
  unit_price numeric not null,
  discount_amount numeric not null default 0,
  line_total numeric not null,
  notes text
);

create table if not exists public.orders (
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  order_date timestamp with time zone not null default now(),
  status text not null,
  subtotal numeric not null default 0,
  discount_amount numeric not null default 0,
  total_amount numeric not null default 0,
  payment_status text not null,
  created_by uuid not null,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  payment_terms text,
  due_date date,
  needs_invoice boolean,
  invoice_sent_at timestamp with time zone,
  delivery_confirmed_at timestamp with time zone,
  collect_payment_on_delivery boolean not null default false
);

create table if not exists public.payments (
  id uuid not null default gen_random_uuid(),
  payment_date timestamp with time zone not null default now(),
  amount_total numeric not null,
  payment_method text not null,
  reference_number text,
  amount_including_vat numeric default 0,
  amount_before_vat numeric,
  net_amount numeric not null,
  recorded_by uuid not null,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  payment_status payment_status_enum not null default 'pending'::payment_status_enum,
  business_domain business_domain_enum not null,
  project_id uuid,
  order_id uuid,
  property_id uuid,
  due_date date,
  requires_split boolean not null default false,
  check_number text,
  vat_rate numeric,
  vat_amount numeric,
  account_id uuid
);

create table if not exists public.payroll_periods (
  id uuid not null default gen_random_uuid(),
  period_month text not null,
  start_date date not null,
  end_date date not null,
  status text not null
);

create table if not exists public.payslip_items (
  id uuid not null default gen_random_uuid(),
  payslip_id uuid not null,
  item_type text not null,
  amount numeric(12,2) not null,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.payslips (
  id uuid not null default gen_random_uuid(),
  payroll_period_id uuid not null,
  user_id uuid not null,
  calculated_salary_type text not null,
  total_work_minutes integer not null,
  calculated_base_salary numeric not null,
  manual_adjustments numeric not null default 0,
  gross_salary numeric not null,
  notes text
);

create table if not exists public.product_categories (
  id uuid not null default gen_random_uuid(),
  name text not null,
  active boolean not null default true
);

create table if not exists public.products (
  id uuid not null default gen_random_uuid(),
  sku text not null,
  barcode text,
  name text not null,
  category_id uuid not null,
  description text,
  base_price numeric(12,2) not null,
  base_cost numeric(12,2),
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  low_stock_threshold numeric not null default 5
);

create table if not exists public.project_expenses (
  id uuid not null default gen_random_uuid(),
  project_id uuid not null,
  expense_id uuid not null,
  included_in_base_price boolean not null default true,
  billed_to_customer boolean not null default false,
  notes text
);

create table if not exists public.projects (
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  name text not null,
  project_type project_type_enum not null,
  status project_status_enum not null,
  agreed_base_price numeric,
  actual_price numeric,
  expenses_billed_separately boolean not null default false,
  project_manager_id uuid,
  start_date date,
  end_date date,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  items_to_move text[],
  payment_terms text,
  due_date date,
  price_includes_vat boolean not null default false,
  vat_rate numeric
);

create table if not exists public.properties (
  id uuid not null default gen_random_uuid(),
  address text not null,
  asset_description text,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.property_expenses (
  id uuid not null default gen_random_uuid(),
  property_id uuid not null,
  expense_id uuid not null,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.push_alert_config (
  id integer not null default 1,
  recipient_user_ids uuid[] not null default '{}'::uuid[],
  send_morning boolean not null default true,
  send_evening boolean not null default false,
  overdue_tasks boolean not null default true,
  today_tasks boolean not null default true,
  tomorrow_tasks boolean not null default true,
  projects_starting boolean not null default true,
  projects_deadline boolean not null default true,
  deliveries boolean not null default true,
  weekly_summary boolean not null default true
);

create table if not exists public.push_subscriptions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.recurring_expense_templates (
  id uuid not null default gen_random_uuid(),
  template_name text not null,
  category text not null,
  amount numeric(12,2) not null,
  description_template text,
  notes_template text,
  business_domain text not null,
  project_id uuid,
  order_id uuid,
  property_id uuid,
  included_in_base_price boolean not null default false,
  billed_to_customer boolean not null default false,
  project_expense_notes_template text,
  frequency text not null default 'monthly'::text,
  create_day_of_month integer not null default 1,
  expense_day_of_month integer not null default 1,
  create_month_of_year integer,
  expense_month_of_year integer,
  start_date date,
  end_date date,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.recurring_task_template_assignees (
  id uuid not null default gen_random_uuid(),
  recurring_task_template_id uuid not null,
  user_id uuid not null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.recurring_task_templates (
  id uuid not null default gen_random_uuid(),
  subject_template text not null,
  description_template text,
  business_domain text not null,
  project_id uuid,
  property_id uuid,
  default_priority text not null default 'medium'::text,
  default_status text not null default 'todo'::text,
  frequency text not null default 'monthly'::text,
  create_day_of_month integer not null default 1,
  due_day_of_month integer not null default 1,
  start_date date,
  end_date date,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.reminders (
  id uuid not null default gen_random_uuid(),
  customer_id uuid,
  project_id uuid,
  property_id uuid,
  order_id uuid,
  reminder_user_id uuid,
  reminder_at timestamp with time zone,
  content text,
  action_type text not null,
  status text not null default 'pending'::text,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  assigned_to uuid,
  remind_at timestamp with time zone not null,
  category text not null default 'collection'::text,
  payment_id uuid,
  communication_log_id uuid,
  task_id uuid,
  notified_at timestamp with time zone
);

create table if not exists public.salary_agreements (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  salary_type text not null,
  hourly_rate numeric,
  monthly_salary numeric,
  valid_from date not null,
  valid_to date,
  notes text,
  overtime_rate numeric,
  standard_daily_hours numeric not null default 9.0,
  due_day_of_next_month integer not null default 10
);

create table if not exists public.tags (
  id uuid not null default gen_random_uuid(),
  kind text not null default 'general'::text,
  name text not null,
  color text,
  is_active boolean not null default true,
  notes text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.task_comments (
  id uuid not null default gen_random_uuid(),
  task_id uuid not null,
  author_id uuid,
  body text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.task_members (
  task_id uuid not null,
  user_id uuid not null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.task_time_reports (
  id uuid not null default gen_random_uuid(),
  task_id uuid not null,
  user_id uuid not null,
  start_time timestamp with time zone not null,
  end_time timestamp with time zone not null,
  minutes_worked integer not null,
  notes text
);

create table if not exists public.tasks (
  id uuid not null default gen_random_uuid(),
  subject text not null,
  description text,
  status task_status_enum not null default 'todo'::task_status_enum,
  priority task_priority_enum not null default 'medium'::task_priority_enum,
  due_date timestamp with time zone,
  assigned_user_id uuid,
  project_id uuid,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  business_domain business_domain_enum,
  property_id uuid,
  recurring_task_template_id uuid,
  recurrence_key text,
  due_time text,
  city text,
  address text,
  is_private boolean not null default false,
  private_owner_id uuid
);

create table if not exists public.users (
  id uuid not null default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  role user_role_enum default 'worker_no_access'::user_role_enum,
  active boolean not null default true,
  system_access boolean not null default true,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  auth_user_id uuid,
  pay_tracking_mode text not null default 'session'::text,
  payroll_worker_type text not null default 'session_only'::text,
  font_scale real,
  dashboard_prefs jsonb,
  avatar_color text
);

create table if not exists public.vehicles (
  id uuid not null default gen_random_uuid(),
  tag_id uuid not null,
  license_plate text,
  make_model text,
  year integer,
  test_due_date date,
  insurance_due_date date,
  license_due_date date,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  owner_name text
);

create table if not exists public.worker_payment_allocations (
  id uuid not null default gen_random_uuid(),
  worker_payment_id uuid not null,
  source_type text not null,
  attendance_session_id uuid,
  payslip_id uuid,
  amount numeric(12,2) not null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.worker_payments (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  payment_date date not null,
  amount numeric(12,2) not null,
  payment_method text,
  reference_number text,
  notes text,
  recorded_by uuid,
  created_at timestamp with time zone not null default now(),
  account_id uuid
);

-- ===== constraints =====
alter table public.accounts add constraint accounts_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.accounts add constraint accounts_kind_check CHECK ((kind = ANY (ARRAY['bank'::text, 'cash'::text, 'card'::text])));
alter table public.accounts add constraint accounts_pkey PRIMARY KEY (id);
alter table public.attendance_sessions add constraint attendance_checkout_after_checkin CHECK (((clock_out IS NULL) OR (clock_out > clock_in)));
alter table public.attendance_sessions add constraint attendance_logistics_requires_project_chk CHECK (((business_domain <> 'logistics_projects'::business_domain_enum) OR (project_id IS NOT NULL)));
alter table public.attendance_sessions add constraint attendance_only_one_target_chk CHECK (((CASE WHEN (project_id IS NOT NULL) THEN 1 ELSE 0 END + CASE WHEN (property_id IS NOT NULL) THEN 1 ELSE 0 END) <= 1));
alter table public.attendance_sessions add constraint attendance_property_requires_property_chk CHECK (((business_domain <> 'property_management'::business_domain_enum) OR (property_id IS NOT NULL)));
alter table public.attendance_sessions add constraint attendance_sessions_pkey PRIMARY KEY (id);
alter table public.attendance_sessions add constraint attendance_sessions_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.attendance_sessions add constraint attendance_sessions_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.attendance_sessions add constraint attendance_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public.attendance_sessions add constraint attendance_sessions_worked_minutes_check CHECK ((worked_minutes >= 0));
alter table public.audit_logs add constraint audit_logs_pkey PRIMARY KEY (id);
alter table public.business_settings add constraint business_settings_pkey PRIMARY KEY (id);
alter table public.business_settings add constraint business_settings_singleton CHECK ((id = true));
alter table public.card_statement_rows add constraint card_statement_rows_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE SET NULL;
alter table public.card_statement_rows add constraint card_statement_rows_income_payment_id_fkey FOREIGN KEY (income_payment_id) REFERENCES payments(id) ON DELETE SET NULL;
alter table public.card_statement_rows add constraint card_statement_rows_pkey PRIMARY KEY (id);
alter table public.card_statement_rows add constraint card_statement_rows_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.card_statement_rows add constraint card_statement_rows_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.card_statement_rows add constraint card_statement_rows_statement_id_fkey FOREIGN KEY (statement_id) REFERENCES card_statements(id) ON DELETE CASCADE;
alter table public.card_statements add constraint card_statements_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;
alter table public.card_statements add constraint card_statements_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.card_statements add constraint card_statements_pkey PRIMARY KEY (id);
alter table public.communication_logs add constraint communication_logs_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.communication_logs add constraint communication_logs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
alter table public.communication_logs add constraint communication_logs_direction_check CHECK ((direction = ANY (ARRAY['incoming'::text, 'outgoing'::text])));
alter table public.communication_logs add constraint communication_logs_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table public.communication_logs add constraint communication_logs_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;
alter table public.communication_logs add constraint communication_logs_pkey PRIMARY KEY (id);
alter table public.communication_logs add constraint communication_logs_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.communication_logs add constraint communication_logs_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.communication_logs add constraint communication_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
alter table public.contacts add constraint contacts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.contacts add constraint contacts_pkey PRIMARY KEY (id);
alter table public.customers add constraint customers_morning_match_status_check CHECK ((morning_match_status = ANY (ARRAY['unmatched'::text, 'matched'::text, 'manual_review'::text, 'ignored'::text])));
alter table public.customers add constraint customers_pkey PRIMARY KEY (id);
alter table public.document_links add constraint document_links_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;
alter table public.document_links add constraint document_links_pkey PRIMARY KEY (id);
alter table public.documents add constraint documents_pkey PRIMARY KEY (id);
alter table public.documents add constraint documents_storage_key_key UNIQUE (storage_key);
alter table public.documents add constraint documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.entity_tags add constraint entity_tags_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.entity_tags add constraint entity_tags_entity_type_check CHECK ((entity_type = ANY (ARRAY['task'::text, 'expense'::text, 'payment'::text, 'document'::text, 'work_session'::text])));
alter table public.entity_tags add constraint entity_tags_pkey PRIMARY KEY (id);
alter table public.entity_tags add constraint entity_tags_tag_id_entity_type_entity_id_key UNIQUE (tag_id, entity_type, entity_id);
alter table public.entity_tags add constraint entity_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE;
alter table public.expense_merchant_mappings add constraint expense_merchant_mappings_merchant_key_key UNIQUE (merchant_key);
alter table public.expense_merchant_mappings add constraint expense_merchant_mappings_pkey PRIMARY KEY (id);
alter table public.expense_merchant_mappings add constraint expense_merchant_mappings_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.expense_merchant_mappings add constraint expense_merchant_mappings_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.expense_merchant_mappings add constraint expense_merchant_mappings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.expenses add constraint expenses_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
alter table public.expenses add constraint expenses_amount_check CHECK ((amount >= (0)::numeric));
alter table public.expenses add constraint expenses_logistics_requires_project_chk CHECK (((business_domain <> 'logistics_projects'::business_domain_enum) OR (project_id IS NOT NULL)));
alter table public.expenses add constraint expenses_only_one_target_chk CHECK ((((CASE WHEN (project_id IS NOT NULL) THEN 1 ELSE 0 END + CASE WHEN (order_id IS NOT NULL) THEN 1 ELSE 0 END) + CASE WHEN (property_id IS NOT NULL) THEN 1 ELSE 0 END) <= 1));
alter table public.expenses add constraint expenses_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table public.expenses add constraint expenses_payment_status_check CHECK ((payment_status = ANY (ARRAY['paid'::text, 'partial'::text, 'not_paid'::text])));
alter table public.expenses add constraint expenses_pkey PRIMARY KEY (id);
alter table public.expenses add constraint expenses_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.expenses add constraint expenses_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.expenses add constraint expenses_property_requires_property_chk CHECK (((business_domain <> 'property_management'::business_domain_enum) OR (property_id IS NOT NULL)));
alter table public.expenses add constraint expenses_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT;
alter table public.expenses add constraint expenses_recurring_expense_template_id_fkey FOREIGN KEY (recurring_expense_template_id) REFERENCES recurring_expense_templates(id) ON DELETE SET NULL;
alter table public.hourly_salary_overrides add constraint hourly_salary_overrides_override_hourly_rate_check CHECK ((override_hourly_rate >= (0)::numeric));
alter table public.hourly_salary_overrides add constraint hourly_salary_overrides_pkey PRIMARY KEY (id);
alter table public.hourly_salary_overrides add constraint hourly_salary_overrides_time_check CHECK (((end_time IS NULL) OR (end_time >= start_time)));
alter table public.hourly_salary_overrides add constraint hourly_salary_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public.idempotency_keys add constraint idempotency_keys_pkey PRIMARY KEY (key);
alter table public.inventory add constraint inventory_pkey PRIMARY KEY (product_id);
alter table public.inventory add constraint inventory_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['in'::text, 'out'::text, 'reserve'::text, 'release'::text, 'adjustment'::text])));
alter table public.inventory_movements add constraint inventory_movements_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.inventory_movements add constraint inventory_movements_pkey PRIMARY KEY (id);
alter table public.inventory_movements add constraint inventory_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
alter table public.inventory_movements add constraint inventory_movements_quantity_check CHECK ((quantity > (0)::numeric));
alter table public.lease_agreements add constraint lease_agreements_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
alter table public.lease_agreements add constraint lease_agreements_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;
alter table public.lease_agreements add constraint lease_agreements_pkey PRIMARY KEY (id);
alter table public.lease_agreements add constraint lease_agreements_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE RESTRICT;
alter table public.loan_repayments add constraint loan_repayments_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
alter table public.loan_repayments add constraint loan_repayments_amount_check CHECK ((amount >= (0)::numeric));
alter table public.loan_repayments add constraint loan_repayments_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.loan_repayments add constraint loan_repayments_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE;
alter table public.loan_repayments add constraint loan_repayments_pkey PRIMARY KEY (id);
alter table public.loans add constraint loans_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
alter table public.loans add constraint loans_amount_check CHECK ((amount >= (0)::numeric));
alter table public.loans add constraint loans_counterparty_customer_id_fkey FOREIGN KEY (counterparty_customer_id) REFERENCES customers(id) ON DELETE SET NULL;
alter table public.loans add constraint loans_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.loans add constraint loans_direction_check CHECK ((direction = ANY (ARRAY['taken'::text, 'given'::text])));
alter table public.loans add constraint loans_pkey PRIMARY KEY (id);
alter table public.loans add constraint loans_status_check CHECK ((status = ANY (ARRAY['active'::text, 'partially_repaid'::text, 'repaid'::text, 'written_off'::text])));
alter table public.morning_documents add constraint morning_documents_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);
alter table public.morning_documents add constraint morning_documents_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id);
alter table public.morning_documents add constraint morning_documents_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES users(id);
alter table public.morning_documents add constraint morning_documents_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id);
alter table public.morning_documents add constraint morning_documents_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id);
alter table public.morning_documents add constraint morning_documents_pkey PRIMARY KEY (id);
alter table public.morning_documents add constraint morning_documents_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id);
alter table public.morning_settings add constraint morning_settings_id_check CHECK ((id = true));
alter table public.morning_settings add constraint morning_settings_invoice_type_on_completion_check CHECK ((invoice_type_on_completion = ANY (ARRAY[305, 320])));
alter table public.morning_settings add constraint morning_settings_pkey PRIMARY KEY (id);
alter table public.morning_settings add constraint morning_settings_receipt_type_on_payment_check CHECK ((receipt_type_on_payment = ANY (ARRAY[400, 320])));
alter table public.morning_settings add constraint morning_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id);
alter table public.order_items add constraint order_items_discount_amount_check CHECK ((discount_amount >= (0)::numeric));
alter table public.order_items add constraint order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.order_items add constraint order_items_pkey PRIMARY KEY (id);
alter table public.order_items add constraint order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
alter table public.order_items add constraint order_items_quantity_delivered_check CHECK ((quantity_delivered >= (0)::numeric));
alter table public.order_items add constraint order_items_quantity_ordered_check CHECK ((quantity_ordered > (0)::numeric));
alter table public.orders add constraint orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;
alter table public.orders add constraint orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
alter table public.orders add constraint orders_payment_status_check CHECK ((payment_status = ANY (ARRAY['unpaid'::text, 'partial'::text, 'paid'::text])));
alter table public.orders add constraint orders_pkey PRIMARY KEY (id);
alter table public.orders add constraint orders_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'reserved'::text, 'delivered'::text, 'closed'::text])));
alter table public.payments add constraint payments_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
alter table public.payments add constraint payments_amount_before_vat_check CHECK ((amount_before_vat <> (0)::numeric));
alter table public.payments add constraint payments_amount_total_check CHECK ((amount_total <> (0)::numeric));
alter table public.payments add constraint payments_general_home_charity_have_no_target_chk CHECK (((business_domain <> ALL (ARRAY['general_business'::business_domain_enum, 'home'::business_domain_enum, 'charity'::business_domain_enum])) OR ((project_id IS NULL) AND (order_id IS NULL) AND (property_id IS NULL))));
alter table public.payments add constraint payments_logistics_requires_project_chk CHECK (((business_domain <> 'logistics_projects'::business_domain_enum) OR (project_id IS NOT NULL)));
alter table public.payments add constraint payments_net_amount_check CHECK ((net_amount <> (0)::numeric));
alter table public.payments add constraint payments_only_one_target_chk CHECK ((((CASE WHEN (project_id IS NOT NULL) THEN 1 ELSE 0 END + CASE WHEN (order_id IS NOT NULL) THEN 1 ELSE 0 END) + CASE WHEN (property_id IS NOT NULL) THEN 1 ELSE 0 END) <= 1));
alter table public.payments add constraint payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table public.payments add constraint payments_pkey PRIMARY KEY (id);
alter table public.payments add constraint payments_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.payments add constraint payments_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.payments add constraint payments_property_requires_property_chk CHECK (((business_domain <> 'property_management'::business_domain_enum) OR (property_id IS NOT NULL)));
alter table public.payments add constraint payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT;
alter table public.payments add constraint payments_sales_requires_order_chk CHECK (((business_domain <> 'sales'::business_domain_enum) OR (order_id IS NOT NULL)));
alter table public.payments add constraint payments_split_consistency_chk CHECK ((((requires_split = false) AND (amount_total IS NOT NULL) AND (round(net_amount, 2) = round(amount_total, 2)) AND (amount_including_vat IS NULL) AND (amount_before_vat IS NULL) AND ((vat_amount IS NULL) OR (round(vat_amount, 2) = (0)::numeric))) OR ((requires_split = true) AND (amount_total IS NOT NULL) AND (amount_including_vat IS NOT NULL) AND (amount_before_vat IS NOT NULL) AND (round(amount_including_vat, 2) = round(amount_total, 2)) AND (round(net_amount, 2) = round(amount_before_vat, 2)) AND (round(COALESCE(vat_amount, (0)::numeric), 2) = round((amount_total - net_amount), 2)))));
alter table public.payroll_periods add constraint payroll_periods_period_month_key UNIQUE (period_month);
alter table public.payroll_periods add constraint payroll_periods_pkey PRIMARY KEY (id);
alter table public.payroll_periods add constraint payroll_periods_status_check CHECK ((status = ANY (ARRAY['open'::text, 'locked'::text, 'paid'::text])));
alter table public.payroll_periods add constraint perion_is_valid CHECK ((start_date < end_date));
alter table public.payslip_items add constraint payslip_items_item_type_check CHECK ((item_type = ANY (ARRAY['bonus'::text, 'fine'::text, 'travel'::text, 'expense_reimbursement'::text, 'advance'::text, 'deduction'::text, 'other'::text])));
alter table public.payslip_items add constraint payslip_items_payslip_id_fkey FOREIGN KEY (payslip_id) REFERENCES payslips(id) ON DELETE CASCADE;
alter table public.payslip_items add constraint payslip_items_pkey PRIMARY KEY (id);
alter table public.payslips add constraint payslips_payroll_period_id_fkey FOREIGN KEY (payroll_period_id) REFERENCES payroll_periods(id) ON DELETE RESTRICT;
alter table public.payslips add constraint payslips_payroll_period_id_user_id_key UNIQUE (payroll_period_id, user_id);
alter table public.payslips add constraint payslips_pkey PRIMARY KEY (id);
alter table public.payslips add constraint payslips_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
alter table public.product_categories add constraint product_categories_name_key UNIQUE (name);
alter table public.product_categories add constraint product_categories_pkey PRIMARY KEY (id);
alter table public.products add constraint products_barcode_key UNIQUE (barcode);
alter table public.products add constraint products_base_price_check CHECK ((base_price > (0)::numeric));
alter table public.products add constraint products_category_id_fkey FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE RESTRICT;
alter table public.products add constraint products_low_stock_threshold_nonnegative CHECK ((low_stock_threshold >= (0)::numeric));
alter table public.products add constraint products_pkey PRIMARY KEY (id);
alter table public.products add constraint products_sku_key UNIQUE (sku);
alter table public.project_expenses add constraint project_expenses_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE RESTRICT;
alter table public.project_expenses add constraint project_expenses_pkey PRIMARY KEY (id);
alter table public.project_expenses add constraint project_expenses_project_id_expense_id_key UNIQUE (project_id, expense_id);
alter table public.project_expenses add constraint project_expenses_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.projects add constraint project_dates_valid CHECK (((end_date IS NULL) OR (end_date >= start_date)));
alter table public.projects add constraint projects_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
alter table public.projects add constraint projects_pkey PRIMARY KEY (id);
alter table public.projects add constraint projects_project_manager_id_fkey FOREIGN KEY (project_manager_id) REFERENCES users(id) ON DELETE SET NULL;
alter table public.properties add constraint properties_pkey PRIMARY KEY (id);
alter table public.property_expenses add constraint property_expenses_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE;
alter table public.property_expenses add constraint property_expenses_expense_id_key UNIQUE (expense_id);
alter table public.property_expenses add constraint property_expenses_pkey PRIMARY KEY (id);
alter table public.property_expenses add constraint property_expenses_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;
alter table public.push_alert_config add constraint push_alert_config_id_check CHECK ((id = 1));
alter table public.push_alert_config add constraint push_alert_config_pkey PRIMARY KEY (id);
alter table public.push_subscriptions add constraint push_subscriptions_pkey PRIMARY KEY (id);
alter table public.push_subscriptions add constraint push_subscriptions_user_id_endpoint_key UNIQUE (user_id, endpoint);
alter table public.push_subscriptions add constraint push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.recurring_expense_templates add constraint recurring_expense_templates_amount_check CHECK ((amount > (0)::numeric));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_business_domain_check CHECK ((business_domain = ANY (ARRAY['home'::text, 'charity'::text, 'general_business'::text, 'logistics_projects'::text, 'sales'::text, 'property_management'::text, 'spaceit'::text])));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_check CHECK (((end_date IS NULL) OR (start_date IS NULL) OR (end_date >= start_date)));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_check1 CHECK ((num_nonnulls(project_id, order_id, property_id) <= 1));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_check2 CHECK ((((business_domain = 'logistics_projects'::text) AND (project_id IS NOT NULL) AND (order_id IS NULL) AND (property_id IS NULL)) OR ((business_domain = 'property_management'::text) AND (property_id IS NOT NULL) AND (project_id IS NULL) AND (order_id IS NULL)) OR ((business_domain <> ALL (ARRAY['logistics_projects'::text, 'property_management'::text])) AND (project_id IS NULL) AND (property_id IS NULL))));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_check3 CHECK ((((frequency = 'monthly'::text) AND (create_month_of_year IS NULL) AND (expense_month_of_year IS NULL)) OR ((frequency = 'yearly'::text) AND (create_month_of_year IS NOT NULL) AND (expense_month_of_year IS NOT NULL))));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_create_day_of_month_check CHECK (((create_day_of_month >= 1) AND (create_day_of_month <= 31)));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_create_month_of_year_check CHECK (((create_month_of_year >= 1) AND (create_month_of_year <= 12)));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.recurring_expense_templates add constraint recurring_expense_templates_expense_day_of_month_check CHECK (((expense_day_of_month >= 1) AND (expense_day_of_month <= 31)));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_expense_month_of_year_check CHECK (((expense_month_of_year >= 1) AND (expense_month_of_year <= 12)));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_frequency_check CHECK ((frequency = ANY (ARRAY['monthly'::text, 'yearly'::text])));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table public.recurring_expense_templates add constraint recurring_expense_templates_pkey PRIMARY KEY (id);
alter table public.recurring_expense_templates add constraint recurring_expense_templates_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.recurring_expense_templates add constraint recurring_expense_templates_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.recurring_task_template_assignees add constraint recurring_task_template_assig_recurring_task_template_id_us_key UNIQUE (recurring_task_template_id, user_id);
alter table public.recurring_task_template_assignees add constraint recurring_task_template_assigne_recurring_task_template_id_fkey FOREIGN KEY (recurring_task_template_id) REFERENCES recurring_task_templates(id) ON DELETE CASCADE;
alter table public.recurring_task_template_assignees add constraint recurring_task_template_assignees_pkey PRIMARY KEY (id);
alter table public.recurring_task_template_assignees add constraint recurring_task_template_assignees_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public.recurring_task_templates add constraint recurring_task_templates_business_domain_check CHECK ((business_domain = ANY (ARRAY['home'::text, 'charity'::text, 'general_business'::text, 'logistics_projects'::text, 'sales'::text, 'property_management'::text, 'spaceit'::text])));
alter table public.recurring_task_templates add constraint recurring_task_templates_check CHECK ((((business_domain = 'logistics_projects'::text) AND (project_id IS NOT NULL) AND (property_id IS NULL)) OR ((business_domain = 'property_management'::text) AND (project_id IS NULL) AND (property_id IS NOT NULL)) OR ((business_domain <> ALL (ARRAY['logistics_projects'::text, 'property_management'::text])) AND (project_id IS NULL) AND (property_id IS NULL))));
alter table public.recurring_task_templates add constraint recurring_task_templates_check1 CHECK (((end_date IS NULL) OR (start_date IS NULL) OR (end_date >= start_date)));
alter table public.recurring_task_templates add constraint recurring_task_templates_create_day_of_month_check CHECK (((create_day_of_month >= 1) AND (create_day_of_month <= 31)));
alter table public.recurring_task_templates add constraint recurring_task_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.recurring_task_templates add constraint recurring_task_templates_default_priority_check CHECK ((default_priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text])));
alter table public.recurring_task_templates add constraint recurring_task_templates_default_status_check CHECK ((default_status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'blocked'::text, 'done'::text, 'cancelled'::text])));
alter table public.recurring_task_templates add constraint recurring_task_templates_due_day_of_month_check CHECK (((due_day_of_month >= 1) AND (due_day_of_month <= 31)));
alter table public.recurring_task_templates add constraint recurring_task_templates_frequency_check CHECK ((frequency = 'monthly'::text));
alter table public.recurring_task_templates add constraint recurring_task_templates_pkey PRIMARY KEY (id);
alter table public.recurring_task_templates add constraint recurring_task_templates_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.recurring_task_templates add constraint recurring_task_templates_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_action_type_check CHECK ((action_type = ANY (ARRAY['call'::text, 'email'::text, 'whatsapp'::text, 'meeting'::text, 'task'::text, 'other'::text])));
alter table public.reminders add constraint reminders_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_communication_log_id_fkey FOREIGN KEY (communication_log_id) REFERENCES communication_logs(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_pkey PRIMARY KEY (id);
alter table public.reminders add constraint reminders_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_reminder_user_id_fkey FOREIGN KEY (reminder_user_id) REFERENCES users(id) ON DELETE RESTRICT;
alter table public.reminders add constraint reminders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'done'::text, 'cancelled'::text])));
alter table public.reminders add constraint reminders_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.reminders add constraint reminders_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.salary_agreements add constraint salary_agreements_check CHECK ((((salary_type = 'hourly'::text) AND (hourly_rate IS NOT NULL) AND (monthly_salary IS NULL)) OR ((salary_type = 'monthly'::text) AND (monthly_salary IS NOT NULL) AND (hourly_rate IS NULL))));
alter table public.salary_agreements add constraint salary_agreements_due_day_of_next_month_check CHECK (((due_day_of_next_month >= 1) AND (due_day_of_next_month <= 31)));
alter table public.salary_agreements add constraint salary_agreements_pkey PRIMARY KEY (id);
alter table public.salary_agreements add constraint salary_agreements_salary_type_check CHECK ((salary_type = ANY (ARRAY['hourly'::text, 'monthly'::text])));
alter table public.salary_agreements add constraint salary_agreements_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
alter table public.tags add constraint tags_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.tags add constraint tags_kind_check CHECK ((kind = ANY (ARRAY['general'::text, 'vehicle'::text, 'campaign'::text, 'equipment'::text, 'event'::text, 'vendor'::text])));
alter table public.tags add constraint tags_pkey PRIMARY KEY (id);
alter table public.task_comments add constraint task_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL;
alter table public.task_comments add constraint task_comments_pkey PRIMARY KEY (id);
alter table public.task_comments add constraint task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.task_members add constraint task_members_pkey PRIMARY KEY (task_id, user_id);
alter table public.task_members add constraint task_members_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.task_members add constraint task_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public.task_time_reports add constraint started_before_ended CHECK (((end_time IS NULL) OR (end_time >= start_time)));
alter table public.task_time_reports add constraint task_time_reports_minutes_worked_check CHECK ((minutes_worked > 0));
alter table public.task_time_reports add constraint task_time_reports_pkey PRIMARY KEY (id);
alter table public.task_time_reports add constraint task_time_reports_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.task_time_reports add constraint task_time_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public.tasks add constraint tasks_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL;
alter table public.tasks add constraint tasks_business_domain_target_check CHECK ((((business_domain = 'logistics_projects'::business_domain_enum) AND (project_id IS NOT NULL) AND (property_id IS NULL)) OR ((business_domain = 'property_management'::business_domain_enum) AND (project_id IS NULL) AND (property_id IS NOT NULL)) OR ((business_domain <> ALL (ARRAY['logistics_projects'::business_domain_enum, 'property_management'::business_domain_enum])) AND (project_id IS NULL) AND (property_id IS NULL)))) NOT VALID;
alter table public.tasks add constraint tasks_logistics_requires_project_chk CHECK (((business_domain <> 'logistics_projects'::business_domain_enum) OR (project_id IS NOT NULL)));
alter table public.tasks add constraint tasks_only_one_target_chk CHECK (((CASE WHEN (project_id IS NOT NULL) THEN 1 ELSE 0 END + CASE WHEN (property_id IS NOT NULL) THEN 1 ELSE 0 END) <= 1));
alter table public.tasks add constraint tasks_pkey PRIMARY KEY (id);
alter table public.tasks add constraint tasks_private_owner_id_fkey FOREIGN KEY (private_owner_id) REFERENCES users(id) ON DELETE SET NULL;
alter table public.tasks add constraint tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.tasks add constraint tasks_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.tasks add constraint tasks_property_requires_property_chk CHECK (((business_domain <> 'property_management'::business_domain_enum) OR (property_id IS NOT NULL)));
alter table public.tasks add constraint tasks_recurring_task_template_id_fkey FOREIGN KEY (recurring_task_template_id) REFERENCES recurring_task_templates(id) ON DELETE SET NULL;
alter table public.users add constraint users_auth_user_id_fk FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.users add constraint users_avatar_color_check CHECK (((avatar_color IS NULL) OR (avatar_color ~ '^#[0-9A-Fa-f]{6}$'::text)));
alter table public.users add constraint users_email_key UNIQUE (email);
alter table public.users add constraint users_font_scale_check CHECK (((font_scale IS NULL) OR ((font_scale >= (0.5)::double precision) AND (font_scale <= (2)::double precision))));
alter table public.users add constraint users_pay_tracking_mode_check CHECK ((pay_tracking_mode = ANY (ARRAY['session'::text, 'payslip'::text])));
alter table public.users add constraint users_payroll_worker_type_check CHECK ((payroll_worker_type = ANY (ARRAY['session_only'::text, 'monthly_payslip'::text, 'hourly_payslip'::text])));
alter table public.users add constraint users_pkey PRIMARY KEY (id);
alter table public.vehicles add constraint vehicles_pkey PRIMARY KEY (id);
alter table public.vehicles add constraint vehicles_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE;
alter table public.vehicles add constraint vehicles_tag_id_key UNIQUE (tag_id);
alter table public.worker_payment_allocations add constraint worker_payment_allocations_amount_check CHECK ((amount > (0)::numeric));
alter table public.worker_payment_allocations add constraint worker_payment_allocations_attendance_session_id_fkey FOREIGN KEY (attendance_session_id) REFERENCES attendance_sessions(id);
alter table public.worker_payment_allocations add constraint worker_payment_allocations_check CHECK ((((source_type = 'session'::text) AND (attendance_session_id IS NOT NULL) AND (payslip_id IS NULL)) OR ((source_type = 'payslip'::text) AND (payslip_id IS NOT NULL) AND (attendance_session_id IS NULL))));
alter table public.worker_payment_allocations add constraint worker_payment_allocations_payslip_id_fkey FOREIGN KEY (payslip_id) REFERENCES payslips(id);
alter table public.worker_payment_allocations add constraint worker_payment_allocations_pkey PRIMARY KEY (id);
alter table public.worker_payment_allocations add constraint worker_payment_allocations_source_type_check CHECK ((source_type = ANY (ARRAY['session'::text, 'payslip'::text])));
alter table public.worker_payment_allocations add constraint worker_payment_allocations_worker_payment_id_fkey FOREIGN KEY (worker_payment_id) REFERENCES worker_payments(id) ON DELETE CASCADE;
alter table public.worker_payments add constraint worker_payments_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
alter table public.worker_payments add constraint worker_payments_amount_check CHECK ((amount > (0)::numeric));
alter table public.worker_payments add constraint worker_payments_pkey PRIMARY KEY (id);
alter table public.worker_payments add constraint worker_payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES users(id);
alter table public.worker_payments add constraint worker_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

-- ===== indexes =====
-- TODO

-- ===== functions =====
-- TODO

-- ===== views =====
-- TODO

-- ===== triggers =====
-- TODO

-- ===== RLS + policies =====
-- TODO

-- ===== grants =====
-- TODO
