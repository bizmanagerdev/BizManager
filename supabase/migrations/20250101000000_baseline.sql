-- ════════════════════════════════════════════════════════════════════════════
-- BASELINE SCHEMA — originally captured from production 2026-06-29 (public
-- schema), backfilled 2026-09-10 via a real `pg_dump --schema-only` + targeted
-- catalog queries (direct DB access finally available this session).
--
-- Dependency order: extensions → enums → tables → constraints → indexes →
-- functions → views → triggers → RLS → policies → grants.
--
-- STATUS (2026-09-10): this file now applies CLEANLY, standalone, from a truly
-- empty Postgres database — verified directly (not assumed) by creating an
-- isolated throwaway database on the live server, applying this file to it,
-- and confirming zero errors. That closed several real, previously-undetected
-- gaps in the original capture:
--   - 13 whole tables were missing entirely (account_transfers,
--     card_account_mappings, card_statement_charges, customer_branches,
--     dunning_stages, fcm_tokens, notifications, order_delivery_recipients,
--     payment_promises, phone_attendance_reports, user_sessions,
--     vehicle_mileage_readings, worker_absences).
--   - 125 columns were missing across 23 of the originally-captured tables
--     (added via `add column if not exists`, so a later migration that also
--     adds one of these is a harmless no-op instead of a duplicate error).
--   - The constraints section listed FOREIGN KEY constraints interleaved
--     alphabetically by table with PRIMARY KEY/UNIQUE/CHECK constraints, so a
--     table sorting after the table it referenced (e.g. accounts before
--     users) failed on a from-scratch apply. Fixed by splitting into two
--     passes: every non-FK constraint first, then every FK constraint.
--   - The functions section had a genuine forward-reference bug (a handful of
--     functions calling another function defined later in the same file) —
--     fixed via an actual dependency analysis + topological sort, not a
--     blind reorder.
--   - pg_trgm was missing from the extensions list (added live via a later
--     migration, but this file's own index section already captures the
--     resulting trigram indexes as part of the current-state snapshot).
--
-- KNOWN REMAINING GAP: this file's views/functions/triggers/RLS policies now
-- reflect the CURRENT (2026-09-10) live shape, not the historical 2026-06-29
-- one — so while THIS file applies cleanly standalone, replaying the ~130+
-- migrations that come after it does not yet fully succeed: several of them
-- recreate a view in an older/smaller shape than what's already here, and
-- Postgres's CREATE OR REPLACE VIEW can't drop columns. Fixing that is a
-- separate, larger effort (auditing migrations individually), deliberately
-- NOT attempted in this pass — see e2e CI job's continue-on-error comment.
-- ════════════════════════════════════════════════════════════════════════════

-- ===== extensions =====
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create extension if not exists pg_stat_statements;
create extension if not exists supabase_vault;
-- Added later live via 20260827214155_search_trigram_indexes.sql, needed here
-- too since this file's own index section (below) already captures the
-- resulting GIN trigram indexes as part of the live index snapshot.
create extension if not exists pg_trgm;

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

-- property_expenses: removed here (2026-09-10, migration-baseline backfill —
-- see foundation-hardening memory). This table was part of the file's
-- original 2026-06-29 content but no longer exists live: confirmed against
-- production directly (information_schema.tables), and
-- supabase/migrations/20260901081541_drop_unused_property_task_tables.sql
-- drops it (guarded, was already empty) later in the chain. Baseline must
-- match current live state, so it's omitted here rather than created only to
-- be dropped again downstream.

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

-- task_time_reports: removed here (2026-09-10, migration-baseline backfill —
-- see foundation-hardening memory). Same situation as property_expenses just
-- above: part of the file's original 2026-06-29 content, confirmed gone from
-- live production, dropped (guarded, empty) by
-- supabase/migrations/20260901081541_drop_unused_property_task_tables.sql
-- later in the chain — along with 3 views built on top of it
-- (task_bottleneck_view, task_time_summary_view, user_workload_view), also
-- absent here for the same reason.

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

-- ===== tables missing from the original baseline capture =====
-- The db:pull session that produced this file truncated partway through
-- (see supabase/migrations/README.md) and missed these 13 tables entirely -
-- found by comparing against the live database's table list.
--
-- Name: account_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_transfers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_account_id uuid NOT NULL,
    to_account_id uuid NOT NULL,
    amount numeric NOT NULL,
    transfer_date date NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_transfers_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT account_transfers_distinct_accounts CHECK ((from_account_id <> to_account_id))
);


--
-- Name: card_account_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.card_account_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    card_key text NOT NULL,
    card_label text NOT NULL,
    account_id uuid NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: card_statement_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.card_statement_charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    statement_id uuid NOT NULL,
    card_label text NOT NULL,
    account_id uuid NOT NULL,
    amount numeric NOT NULL,
    charge_date date NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT card_statement_charges_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: customer_branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    name text NOT NULL,
    address text,
    phone text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dunning_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dunning_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    day_offset integer NOT NULL,
    label text NOT NULL,
    severity text DEFAULT 'warning'::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dunning_stages_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'danger'::text])))
);


--
-- Name: fcm_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fcm_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    platform text DEFAULT 'android'::text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    url text DEFAULT '/alerts'::text NOT NULL,
    category text,
    tag text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_delivery_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_delivery_recipients (
    order_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_promises; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_promises (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid,
    order_id uuid,
    project_id uuid,
    amount numeric(12,2) NOT NULL,
    promised_date date NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    notes text,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_promises_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'kept'::text, 'broken'::text, 'cancelled'::text])))
);


--
-- Name: phone_attendance_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phone_attendance_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    clock_in timestamp with time zone NOT NULL,
    clock_out timestamp with time zone,
    worked_minutes integer,
    status text DEFAULT 'open'::text NOT NULL,
    source text DEFAULT 'phone'::text NOT NULL,
    provider_call_id text,
    attendance_session_id uuid,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reported_by uuid,
    replaces_session_id uuid,
    notes_he text,
    CONSTRAINT phone_attendance_reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'pending_review'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    user_agent text,
    ended_at timestamp with time zone
);


--
-- Name: vehicle_mileage_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_mileage_readings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tag_id uuid NOT NULL,
    reading integer NOT NULL,
    recorded_at date DEFAULT CURRENT_DATE NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vehicle_mileage_readings_reading_check CHECK ((reading >= 0)),
    CONSTRAINT vehicle_mileage_readings_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'expense'::text, 'task'::text])))
);


--
-- Name: worker_absences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_absences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    absence_date date NOT NULL,
    absence_type text DEFAULT 'day_off'::text NOT NULL,
    paid boolean DEFAULT true NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT worker_absences_type_check CHECK ((absence_type = ANY (ARRAY['day_off'::text, 'vacation'::text, 'sick'::text, 'holiday'::text, 'unpaid'::text, 'other'::text])))
);

-- ===== columns missing from the original baseline capture =====
-- Same root cause as the missing-tables block above: these 125 columns
-- across 23 otherwise-captured tables were never included. `if not exists`
-- throughout so a later migration that also (redundantly) adds one of
-- these is a harmless no-op instead of a duplicate-column error.
alter table public.attendance_sessions add column if not exists notes_he text;
alter table public.business_settings add column if not exists cc_fee_rate numeric DEFAULT 0.14 NOT NULL;
alter table public.card_statement_rows add column if not exists card_label text;
alter table public.customers add column if not exists city text NOT NULL;
alter table public.customers add column if not exists delivery_instructions text;
alter table public.customers add column if not exists delivery_lat numeric;
alter table public.customers add column if not exists delivery_lng numeric;
alter table public.customers add column if not exists linked_user_id uuid;
alter table public.expense_merchant_mappings add column if not exists category text;
alter table public.expenses add column if not exists installment_count integer;
alter table public.expenses add column if not exists installment_group_id uuid;
alter table public.expenses add column if not exists installment_index integer;
alter table public.expenses add column if not exists paid_date date;
alter table public.lease_agreements add column if not exists deposit_amount numeric;
alter table public.lease_agreements add column if not exists deposit_reference text;
alter table public.lease_agreements add column if not exists deposit_type text;
alter table public.lease_agreements add column if not exists keys_handed_over integer;
alter table public.loan_repayments add column if not exists installment_count integer;
alter table public.loan_repayments add column if not exists installment_index integer;
alter table public.loan_repayments add column if not exists status text DEFAULT 'paid'::text NOT NULL;
alter table public.order_items add column if not exists description text;
alter table public.orders add column if not exists branch_id uuid;
alter table public.orders add column if not exists requested_delivery_date date;
alter table public.payments add column if not exists check_number text;
alter table public.payslip_items add column if not exists created_by uuid;
alter table public.payslip_items add column if not exists item_date date;
alter table public.payslip_items add column if not exists user_id uuid NOT NULL;
alter table public.projects add column if not exists branch_id uuid;
alter table public.projects add column if not exists destination_address text;
alter table public.projects add column if not exists destination_floor text;
alter table public.projects add column if not exists destination_has_elevator boolean;
alter table public.projects add column if not exists no_charge boolean DEFAULT false NOT NULL;
alter table public.projects add column if not exists origin_address text;
alter table public.projects add column if not exists origin_floor text;
alter table public.projects add column if not exists origin_has_elevator boolean;
alter table public.properties add column if not exists apartments_count integer;
alter table public.properties add column if not exists arnona_contract_number text;
alter table public.properties add column if not exists bathrooms integer;
alter table public.properties add column if not exists electricity_contract_number text;
alter table public.properties add column if not exists floor integer;
alter table public.properties add column if not exists furniture_items text[] DEFAULT '{}'::text[] NOT NULL;
alter table public.properties add column if not exists gas_contract_number text;
alter table public.properties add column if not exists has_elevator boolean DEFAULT false NOT NULL;
alter table public.properties add column if not exists has_parking boolean DEFAULT false NOT NULL;
alter table public.properties add column if not exists has_private_entrance boolean DEFAULT false NOT NULL;
alter table public.properties add column if not exists has_storage_room boolean DEFAULT false NOT NULL;
alter table public.properties add column if not exists is_furnished boolean DEFAULT false NOT NULL;
alter table public.properties add column if not exists key_count integer;
alter table public.properties add column if not exists land_block text;
alter table public.properties add column if not exists land_parcel text;
alter table public.properties add column if not exists land_sub_parcel text;
alter table public.properties add column if not exists light_bulb_count integer;
alter table public.properties add column if not exists mezuzah_count integer;
alter table public.properties add column if not exists name text;
alter table public.properties add column if not exists property_type text;
alter table public.properties add column if not exists purchase_date date;
alter table public.properties add column if not exists purchase_price numeric;
alter table public.properties add column if not exists purchase_tax numeric;
alter table public.properties add column if not exists purchased_from text;
alter table public.properties add column if not exists rooms numeric;
alter table public.properties add column if not exists square_meters numeric;
alter table public.properties add column if not exists water_contract_number text;
-- push_alert_config's missing columns are DELIBERATELY not backfilled here
-- (unlike every other table above) — supabase/migrations/20260701000000_
-- reshape_push_alert_config.sql later DROPS and fully recreates this table
-- (old single-row toggle design -> multi-row uuid-id scheduler), gated on
-- "does the `title` column already exist" as its idempotency check. Adding
-- these columns onto the OLD table shape here would satisfy that check
-- without ever actually reshaping the table, silently skipping the uuid id
-- migration on a from-scratch replay (found by testing this file end to end
-- against an isolated database, not assumed).
alter table public.push_subscriptions add column if not exists last_seen_at timestamp with time zone;
alter table public.push_subscriptions add column if not exists user_agent text;
alter table public.recurring_expense_templates add column if not exists account_id uuid;
alter table public.recurring_expense_templates add column if not exists auto_paid boolean DEFAULT false NOT NULL;
alter table public.recurring_expense_templates add column if not exists interval_months integer DEFAULT 1 NOT NULL;
alter table public.recurring_expense_templates add column if not exists is_variable_amount boolean DEFAULT false NOT NULL;
alter table public.recurring_expense_templates add column if not exists reminder_work_days_before integer;
alter table public.reminders add column if not exists audience_role text;
alter table public.reminders add column if not exists behavior text DEFAULT 'ping_once'::text NOT NULL;
alter table public.reminders add column if not exists dedupe_key text;
alter table public.reminders add column if not exists expense_id uuid;
alter table public.reminders add column if not exists invoice_id uuid;
alter table public.reminders add column if not exists max_pings integer;
alter table public.reminders add column if not exists next_ping_at timestamp with time zone;
alter table public.reminders add column if not exists ping_count integer DEFAULT 0 NOT NULL;
alter table public.reminders add column if not exists repeat_rule text;
alter table public.reminders add column if not exists resolved_at timestamp with time zone;
alter table public.reminders add column if not exists severity text DEFAULT 'info'::text NOT NULL;
alter table public.reminders add column if not exists snoozed_by uuid;
alter table public.reminders add column if not exists snoozed_until timestamp with time zone;
alter table public.reminders add column if not exists source text DEFAULT 'manual'::text NOT NULL;
alter table public.reminders add column if not exists title text;
alter table public.reminders add column if not exists url text;
alter table public.reminders add column if not exists vehicle_id uuid;
alter table public.salary_agreements add column if not exists bill_to_customer_amount numeric(12,2);
alter table public.salary_agreements add column if not exists business_domain text DEFAULT 'general_business'::text NOT NULL;
alter table public.salary_agreements add column if not exists is_billable_to_customer boolean DEFAULT false NOT NULL;
alter table public.salary_agreements add column if not exists project_id uuid;
alter table public.salary_agreements add column if not exists property_id uuid;
alter table public.task_comments add column if not exists body_he text;
alter table public.tasks add column if not exists customer_id uuid;
alter table public.tasks add column if not exists description_ar text;
alter table public.tasks add column if not exists description_he text;
alter table public.tasks add column if not exists sort_order double precision;
alter table public.tasks add column if not exists subject_ar text;
alter table public.tasks add column if not exists subject_he text;
alter table public.users add column if not exists digest_seen_at timestamp with time zone;
alter table public.users add column if not exists font_scale_mobile real;
alter table public.users add column if not exists inbox_seen_at timestamp with time zone;
alter table public.users add column if not exists last_seen_at timestamp with time zone;
alter table public.users add column if not exists locale text DEFAULT 'he'::text NOT NULL;
alter table public.users add column if not exists notification_prefs jsonb;
alter table public.users add column if not exists section_access jsonb;
alter table public.users add column if not exists worklist_prefs jsonb;
alter table public.vehicles add column if not exists insurance_source_task_id uuid;
alter table public.vehicles add column if not exists license_source_task_id uuid;
alter table public.vehicles add column if not exists mileage integer;
alter table public.vehicles add column if not exists mileage_updated_at date;
alter table public.vehicles add column if not exists photo_document_id uuid;
alter table public.vehicles add column if not exists test_source_task_id uuid;

-- ===== constraints =====
-- Non-FK constraints (PRIMARY KEY / UNIQUE / CHECK) first, then all
-- FOREIGN KEY constraints -- a FK can only be added once the table it
-- references already has a matching unique/primary key, and this list
-- is alphabetical by table, so (e.g.) accounts_created_by_fkey -> users(id)
-- would otherwise run before users_pkey exists on a from-scratch apply.
alter table public.accounts add constraint accounts_kind_check CHECK ((kind = ANY (ARRAY['bank'::text, 'cash'::text, 'card'::text])));
alter table public.accounts add constraint accounts_pkey PRIMARY KEY (id);
alter table public.attendance_sessions add constraint attendance_checkout_after_checkin CHECK (((clock_out IS NULL) OR (clock_out > clock_in)));
alter table public.attendance_sessions add constraint attendance_logistics_requires_project_chk CHECK (((business_domain <> 'logistics_projects'::business_domain_enum) OR (project_id IS NOT NULL)));
alter table public.attendance_sessions add constraint attendance_only_one_target_chk CHECK (((CASE WHEN (project_id IS NOT NULL) THEN 1 ELSE 0 END + CASE WHEN (property_id IS NOT NULL) THEN 1 ELSE 0 END) <= 1));
alter table public.attendance_sessions add constraint attendance_property_requires_property_chk CHECK (((business_domain <> 'property_management'::business_domain_enum) OR (property_id IS NOT NULL)));
alter table public.attendance_sessions add constraint attendance_sessions_pkey PRIMARY KEY (id);
alter table public.attendance_sessions add constraint attendance_sessions_worked_minutes_check CHECK ((worked_minutes >= 0));
alter table public.audit_logs add constraint audit_logs_pkey PRIMARY KEY (id);
alter table public.business_settings add constraint business_settings_pkey PRIMARY KEY (id);
alter table public.business_settings add constraint business_settings_singleton CHECK ((id = true));
alter table public.card_statement_rows add constraint card_statement_rows_pkey PRIMARY KEY (id);
alter table public.card_statements add constraint card_statements_pkey PRIMARY KEY (id);
alter table public.communication_logs add constraint communication_logs_direction_check CHECK ((direction = ANY (ARRAY['incoming'::text, 'outgoing'::text])));
alter table public.communication_logs add constraint communication_logs_pkey PRIMARY KEY (id);
alter table public.contacts add constraint contacts_pkey PRIMARY KEY (id);
alter table public.customers add constraint customers_morning_match_status_check CHECK ((morning_match_status = ANY (ARRAY['unmatched'::text, 'matched'::text, 'manual_review'::text, 'ignored'::text])));
alter table public.customers add constraint customers_pkey PRIMARY KEY (id);
alter table public.document_links add constraint document_links_pkey PRIMARY KEY (id);
alter table public.documents add constraint documents_pkey PRIMARY KEY (id);
alter table public.documents add constraint documents_storage_key_key UNIQUE (storage_key);
alter table public.entity_tags add constraint entity_tags_entity_type_check CHECK ((entity_type = ANY (ARRAY['task'::text, 'expense'::text, 'payment'::text, 'document'::text, 'work_session'::text])));
alter table public.entity_tags add constraint entity_tags_pkey PRIMARY KEY (id);
alter table public.entity_tags add constraint entity_tags_tag_id_entity_type_entity_id_key UNIQUE (tag_id, entity_type, entity_id);
alter table public.expense_merchant_mappings add constraint expense_merchant_mappings_merchant_key_key UNIQUE (merchant_key);
alter table public.expense_merchant_mappings add constraint expense_merchant_mappings_pkey PRIMARY KEY (id);
alter table public.expenses add constraint expenses_amount_check CHECK ((amount >= (0)::numeric));
alter table public.expenses add constraint expenses_logistics_requires_project_chk CHECK (((business_domain <> 'logistics_projects'::business_domain_enum) OR (project_id IS NOT NULL)));
alter table public.expenses add constraint expenses_only_one_target_chk CHECK ((((CASE WHEN (project_id IS NOT NULL) THEN 1 ELSE 0 END + CASE WHEN (order_id IS NOT NULL) THEN 1 ELSE 0 END) + CASE WHEN (property_id IS NOT NULL) THEN 1 ELSE 0 END) <= 1));
alter table public.expenses add constraint expenses_payment_status_check CHECK ((payment_status = ANY (ARRAY['paid'::text, 'partial'::text, 'not_paid'::text])));
alter table public.expenses add constraint expenses_pkey PRIMARY KEY (id);
alter table public.expenses add constraint expenses_property_requires_property_chk CHECK (((business_domain <> 'property_management'::business_domain_enum) OR (property_id IS NOT NULL)));
alter table public.hourly_salary_overrides add constraint hourly_salary_overrides_override_hourly_rate_check CHECK ((override_hourly_rate >= (0)::numeric));
alter table public.hourly_salary_overrides add constraint hourly_salary_overrides_pkey PRIMARY KEY (id);
alter table public.hourly_salary_overrides add constraint hourly_salary_overrides_time_check CHECK (((end_time IS NULL) OR (end_time >= start_time)));
alter table public.idempotency_keys add constraint idempotency_keys_pkey PRIMARY KEY (key);
alter table public.inventory add constraint inventory_pkey PRIMARY KEY (product_id);
alter table public.inventory_movements add constraint inventory_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['in'::text, 'out'::text, 'reserve'::text, 'release'::text, 'adjustment'::text])));
alter table public.inventory_movements add constraint inventory_movements_pkey PRIMARY KEY (id);
alter table public.inventory_movements add constraint inventory_movements_quantity_check CHECK ((quantity > (0)::numeric));
alter table public.lease_agreements add constraint lease_agreements_pkey PRIMARY KEY (id);
alter table public.loan_repayments add constraint loan_repayments_amount_check CHECK ((amount >= (0)::numeric));
alter table public.loan_repayments add constraint loan_repayments_pkey PRIMARY KEY (id);
alter table public.loans add constraint loans_amount_check CHECK ((amount >= (0)::numeric));
alter table public.loans add constraint loans_direction_check CHECK ((direction = ANY (ARRAY['taken'::text, 'given'::text])));
alter table public.loans add constraint loans_pkey PRIMARY KEY (id);
alter table public.loans add constraint loans_status_check CHECK ((status = ANY (ARRAY['active'::text, 'partially_repaid'::text, 'repaid'::text, 'written_off'::text])));
alter table public.morning_documents add constraint morning_documents_pkey PRIMARY KEY (id);
alter table public.morning_settings add constraint morning_settings_id_check CHECK ((id = true));
alter table public.morning_settings add constraint morning_settings_invoice_type_on_completion_check CHECK ((invoice_type_on_completion = ANY (ARRAY[305, 320])));
alter table public.morning_settings add constraint morning_settings_pkey PRIMARY KEY (id);
alter table public.morning_settings add constraint morning_settings_receipt_type_on_payment_check CHECK ((receipt_type_on_payment = ANY (ARRAY[400, 320])));
alter table public.order_items add constraint order_items_discount_amount_check CHECK ((discount_amount >= (0)::numeric));
alter table public.order_items add constraint order_items_pkey PRIMARY KEY (id);
alter table public.order_items add constraint order_items_quantity_delivered_check CHECK ((quantity_delivered >= (0)::numeric));
alter table public.order_items add constraint order_items_quantity_ordered_check CHECK ((quantity_ordered > (0)::numeric));
alter table public.orders add constraint orders_payment_status_check CHECK ((payment_status = ANY (ARRAY['unpaid'::text, 'partial'::text, 'paid'::text])));
alter table public.orders add constraint orders_pkey PRIMARY KEY (id);
alter table public.orders add constraint orders_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'reserved'::text, 'delivered'::text, 'closed'::text])));
alter table public.payments add constraint payments_amount_before_vat_check CHECK ((amount_before_vat <> (0)::numeric));
alter table public.payments add constraint payments_amount_total_check CHECK ((amount_total <> (0)::numeric));
alter table public.payments add constraint payments_general_home_charity_have_no_target_chk CHECK (((business_domain <> ALL (ARRAY['general_business'::business_domain_enum, 'home'::business_domain_enum, 'charity'::business_domain_enum])) OR ((project_id IS NULL) AND (order_id IS NULL) AND (property_id IS NULL))));
alter table public.payments add constraint payments_logistics_requires_project_chk CHECK (((business_domain <> 'logistics_projects'::business_domain_enum) OR (project_id IS NOT NULL)));
alter table public.payments add constraint payments_net_amount_check CHECK ((net_amount <> (0)::numeric));
alter table public.payments add constraint payments_only_one_target_chk CHECK ((((CASE WHEN (project_id IS NOT NULL) THEN 1 ELSE 0 END + CASE WHEN (order_id IS NOT NULL) THEN 1 ELSE 0 END) + CASE WHEN (property_id IS NOT NULL) THEN 1 ELSE 0 END) <= 1));
alter table public.payments add constraint payments_pkey PRIMARY KEY (id);
alter table public.payments add constraint payments_property_requires_property_chk CHECK (((business_domain <> 'property_management'::business_domain_enum) OR (property_id IS NOT NULL)));
alter table public.payments add constraint payments_sales_requires_order_chk CHECK (((business_domain <> 'sales'::business_domain_enum) OR (order_id IS NOT NULL)));
alter table public.payments add constraint payments_split_consistency_chk CHECK ((((requires_split = false) AND (amount_total IS NOT NULL) AND (round(net_amount, 2) = round(amount_total, 2)) AND (amount_including_vat IS NULL) AND (amount_before_vat IS NULL) AND ((vat_amount IS NULL) OR (round(vat_amount, 2) = (0)::numeric))) OR ((requires_split = true) AND (amount_total IS NOT NULL) AND (amount_including_vat IS NOT NULL) AND (amount_before_vat IS NOT NULL) AND (round(amount_including_vat, 2) = round(amount_total, 2)) AND (round(net_amount, 2) = round(amount_before_vat, 2)) AND (round(COALESCE(vat_amount, (0)::numeric), 2) = round((amount_total - net_amount), 2)))));
alter table public.payroll_periods add constraint payroll_periods_period_month_key UNIQUE (period_month);
alter table public.payroll_periods add constraint payroll_periods_pkey PRIMARY KEY (id);
alter table public.payroll_periods add constraint payroll_periods_status_check CHECK ((status = ANY (ARRAY['open'::text, 'locked'::text, 'paid'::text])));
alter table public.payroll_periods add constraint perion_is_valid CHECK ((start_date < end_date));
alter table public.payslip_items add constraint payslip_items_item_type_check CHECK ((item_type = ANY (ARRAY['bonus'::text, 'fine'::text, 'travel'::text, 'expense_reimbursement'::text, 'advance'::text, 'deduction'::text, 'other'::text])));
alter table public.payslip_items add constraint payslip_items_pkey PRIMARY KEY (id);
alter table public.payslips add constraint payslips_payroll_period_id_user_id_key UNIQUE (payroll_period_id, user_id);
alter table public.payslips add constraint payslips_pkey PRIMARY KEY (id);
alter table public.product_categories add constraint product_categories_name_key UNIQUE (name);
alter table public.product_categories add constraint product_categories_pkey PRIMARY KEY (id);
alter table public.products add constraint products_barcode_key UNIQUE (barcode);
alter table public.products add constraint products_base_price_check CHECK ((base_price > (0)::numeric));
alter table public.products add constraint products_low_stock_threshold_nonnegative CHECK ((low_stock_threshold >= (0)::numeric));
alter table public.products add constraint products_pkey PRIMARY KEY (id);
alter table public.products add constraint products_sku_key UNIQUE (sku);
alter table public.project_expenses add constraint project_expenses_pkey PRIMARY KEY (id);
alter table public.project_expenses add constraint project_expenses_project_id_expense_id_key UNIQUE (project_id, expense_id);
alter table public.projects add constraint project_dates_valid CHECK (((end_date IS NULL) OR (end_date >= start_date)));
alter table public.projects add constraint projects_pkey PRIMARY KEY (id);
alter table public.properties add constraint properties_pkey PRIMARY KEY (id);
alter table public.push_alert_config add constraint push_alert_config_id_check CHECK ((id = 1));
alter table public.push_alert_config add constraint push_alert_config_pkey PRIMARY KEY (id);
alter table public.push_subscriptions add constraint push_subscriptions_pkey PRIMARY KEY (id);
alter table public.push_subscriptions add constraint push_subscriptions_user_id_endpoint_key UNIQUE (user_id, endpoint);
alter table public.recurring_expense_templates add constraint recurring_expense_templates_amount_check CHECK ((amount > (0)::numeric));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_business_domain_check CHECK ((business_domain = ANY (ARRAY['home'::text, 'charity'::text, 'general_business'::text, 'logistics_projects'::text, 'sales'::text, 'property_management'::text, 'spaceit'::text])));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_check CHECK (((end_date IS NULL) OR (start_date IS NULL) OR (end_date >= start_date)));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_check1 CHECK ((num_nonnulls(project_id, order_id, property_id) <= 1));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_check2 CHECK ((((business_domain = 'logistics_projects'::text) AND (project_id IS NOT NULL) AND (order_id IS NULL) AND (property_id IS NULL)) OR ((business_domain = 'property_management'::text) AND (property_id IS NOT NULL) AND (project_id IS NULL) AND (order_id IS NULL)) OR ((business_domain <> ALL (ARRAY['logistics_projects'::text, 'property_management'::text])) AND (project_id IS NULL) AND (property_id IS NULL))));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_check3 CHECK ((((frequency = 'monthly'::text) AND (create_month_of_year IS NULL) AND (expense_month_of_year IS NULL)) OR ((frequency = 'yearly'::text) AND (create_month_of_year IS NOT NULL) AND (expense_month_of_year IS NOT NULL))));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_create_day_of_month_check CHECK (((create_day_of_month >= 1) AND (create_day_of_month <= 31)));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_create_month_of_year_check CHECK (((create_month_of_year >= 1) AND (create_month_of_year <= 12)));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_expense_day_of_month_check CHECK (((expense_day_of_month >= 1) AND (expense_day_of_month <= 31)));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_expense_month_of_year_check CHECK (((expense_month_of_year >= 1) AND (expense_month_of_year <= 12)));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_frequency_check CHECK ((frequency = ANY (ARRAY['monthly'::text, 'yearly'::text])));
alter table public.recurring_expense_templates add constraint recurring_expense_templates_pkey PRIMARY KEY (id);
alter table public.recurring_task_template_assignees add constraint recurring_task_template_assig_recurring_task_template_id_us_key UNIQUE (recurring_task_template_id, user_id);
alter table public.recurring_task_template_assignees add constraint recurring_task_template_assignees_pkey PRIMARY KEY (id);
alter table public.recurring_task_templates add constraint recurring_task_templates_business_domain_check CHECK ((business_domain = ANY (ARRAY['home'::text, 'charity'::text, 'general_business'::text, 'logistics_projects'::text, 'sales'::text, 'property_management'::text, 'spaceit'::text])));
alter table public.recurring_task_templates add constraint recurring_task_templates_check CHECK ((((business_domain = 'logistics_projects'::text) AND (project_id IS NOT NULL) AND (property_id IS NULL)) OR ((business_domain = 'property_management'::text) AND (project_id IS NULL) AND (property_id IS NOT NULL)) OR ((business_domain <> ALL (ARRAY['logistics_projects'::text, 'property_management'::text])) AND (project_id IS NULL) AND (property_id IS NULL))));
alter table public.recurring_task_templates add constraint recurring_task_templates_check1 CHECK (((end_date IS NULL) OR (start_date IS NULL) OR (end_date >= start_date)));
alter table public.recurring_task_templates add constraint recurring_task_templates_create_day_of_month_check CHECK (((create_day_of_month >= 1) AND (create_day_of_month <= 31)));
alter table public.recurring_task_templates add constraint recurring_task_templates_default_priority_check CHECK ((default_priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text])));
alter table public.recurring_task_templates add constraint recurring_task_templates_default_status_check CHECK ((default_status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'blocked'::text, 'done'::text, 'cancelled'::text])));
alter table public.recurring_task_templates add constraint recurring_task_templates_due_day_of_month_check CHECK (((due_day_of_month >= 1) AND (due_day_of_month <= 31)));
alter table public.recurring_task_templates add constraint recurring_task_templates_frequency_check CHECK ((frequency = 'monthly'::text));
alter table public.recurring_task_templates add constraint recurring_task_templates_pkey PRIMARY KEY (id);
alter table public.reminders add constraint reminders_action_type_check CHECK ((action_type = ANY (ARRAY['call'::text, 'email'::text, 'whatsapp'::text, 'meeting'::text, 'task'::text, 'other'::text])));
alter table public.reminders add constraint reminders_pkey PRIMARY KEY (id);
alter table public.reminders add constraint reminders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'done'::text, 'cancelled'::text])));
alter table public.salary_agreements add constraint salary_agreements_check CHECK ((((salary_type = 'hourly'::text) AND (hourly_rate IS NOT NULL) AND (monthly_salary IS NULL)) OR ((salary_type = 'monthly'::text) AND (monthly_salary IS NOT NULL) AND (hourly_rate IS NULL))));
alter table public.salary_agreements add constraint salary_agreements_due_day_of_next_month_check CHECK (((due_day_of_next_month >= 1) AND (due_day_of_next_month <= 31)));
alter table public.salary_agreements add constraint salary_agreements_pkey PRIMARY KEY (id);
alter table public.salary_agreements add constraint salary_agreements_salary_type_check CHECK ((salary_type = ANY (ARRAY['hourly'::text, 'monthly'::text])));
alter table public.tags add constraint tags_kind_check CHECK ((kind = ANY (ARRAY['general'::text, 'vehicle'::text, 'campaign'::text, 'equipment'::text, 'event'::text, 'vendor'::text])));
alter table public.tags add constraint tags_pkey PRIMARY KEY (id);
alter table public.task_comments add constraint task_comments_pkey PRIMARY KEY (id);
alter table public.task_members add constraint task_members_pkey PRIMARY KEY (task_id, user_id);
alter table public.tasks add constraint tasks_business_domain_target_check CHECK ((((business_domain = 'logistics_projects'::business_domain_enum) AND (project_id IS NOT NULL) AND (property_id IS NULL)) OR ((business_domain = 'property_management'::business_domain_enum) AND (project_id IS NULL) AND (property_id IS NOT NULL)) OR ((business_domain <> ALL (ARRAY['logistics_projects'::business_domain_enum, 'property_management'::business_domain_enum])) AND (project_id IS NULL) AND (property_id IS NULL)))) NOT VALID;
alter table public.tasks add constraint tasks_logistics_requires_project_chk CHECK (((business_domain <> 'logistics_projects'::business_domain_enum) OR (project_id IS NOT NULL)));
alter table public.tasks add constraint tasks_only_one_target_chk CHECK (((CASE WHEN (project_id IS NOT NULL) THEN 1 ELSE 0 END + CASE WHEN (property_id IS NOT NULL) THEN 1 ELSE 0 END) <= 1));
alter table public.tasks add constraint tasks_pkey PRIMARY KEY (id);
alter table public.tasks add constraint tasks_property_requires_property_chk CHECK (((business_domain <> 'property_management'::business_domain_enum) OR (property_id IS NOT NULL)));
alter table public.users add constraint users_avatar_color_check CHECK (((avatar_color IS NULL) OR (avatar_color ~ '^#[0-9A-Fa-f]{6}$'::text)));
alter table public.users add constraint users_email_key UNIQUE (email);
alter table public.users add constraint users_font_scale_check CHECK (((font_scale IS NULL) OR ((font_scale >= (0.5)::double precision) AND (font_scale <= (2)::double precision))));
alter table public.users add constraint users_pay_tracking_mode_check CHECK ((pay_tracking_mode = ANY (ARRAY['session'::text, 'payslip'::text])));
alter table public.users add constraint users_payroll_worker_type_check CHECK ((payroll_worker_type = ANY (ARRAY['session_only'::text, 'monthly_payslip'::text, 'hourly_payslip'::text])));
alter table public.users add constraint users_pkey PRIMARY KEY (id);
alter table public.vehicles add constraint vehicles_pkey PRIMARY KEY (id);
alter table public.vehicles add constraint vehicles_tag_id_key UNIQUE (tag_id);
alter table public.worker_payment_allocations add constraint worker_payment_allocations_amount_check CHECK ((amount > (0)::numeric));
alter table public.worker_payment_allocations add constraint worker_payment_allocations_check CHECK ((((source_type = 'session'::text) AND (attendance_session_id IS NOT NULL) AND (payslip_id IS NULL)) OR ((source_type = 'payslip'::text) AND (payslip_id IS NOT NULL) AND (attendance_session_id IS NULL))));
alter table public.worker_payment_allocations add constraint worker_payment_allocations_pkey PRIMARY KEY (id);
alter table public.worker_payment_allocations add constraint worker_payment_allocations_source_type_check CHECK ((source_type = ANY (ARRAY['session'::text, 'payslip'::text])));
alter table public.worker_payments add constraint worker_payments_amount_check CHECK ((amount > (0)::numeric));
alter table public.worker_payments add constraint worker_payments_pkey PRIMARY KEY (id);
--
-- Name: account_transfers account_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_transfers
    ADD CONSTRAINT account_transfers_pkey PRIMARY KEY (id);


--
-- Name: card_account_mappings card_account_mappings_card_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_account_mappings
    ADD CONSTRAINT card_account_mappings_card_key_key UNIQUE (card_key);


--
-- Name: card_account_mappings card_account_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_account_mappings
    ADD CONSTRAINT card_account_mappings_pkey PRIMARY KEY (id);


--
-- Name: card_statement_charges card_statement_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_statement_charges
    ADD CONSTRAINT card_statement_charges_pkey PRIMARY KEY (id);


--
-- Name: card_statement_charges card_statement_charges_unique_card; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_statement_charges
    ADD CONSTRAINT card_statement_charges_unique_card UNIQUE (statement_id, card_label);


--
-- Name: customer_branches customer_branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_branches
    ADD CONSTRAINT customer_branches_pkey PRIMARY KEY (id);


--
-- Name: dunning_stages dunning_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dunning_stages
    ADD CONSTRAINT dunning_stages_pkey PRIMARY KEY (id);


--
-- Name: fcm_tokens fcm_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fcm_tokens
    ADD CONSTRAINT fcm_tokens_pkey PRIMARY KEY (id);


--
-- Name: fcm_tokens fcm_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fcm_tokens
    ADD CONSTRAINT fcm_tokens_token_key UNIQUE (token);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: order_delivery_recipients order_delivery_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_delivery_recipients
    ADD CONSTRAINT order_delivery_recipients_pkey PRIMARY KEY (order_id, user_id);


--
-- Name: payment_promises payment_promises_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_promises
    ADD CONSTRAINT payment_promises_pkey PRIMARY KEY (id);


--
-- Name: phone_attendance_reports phone_attendance_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_attendance_reports
    ADD CONSTRAINT phone_attendance_reports_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: vehicle_mileage_readings vehicle_mileage_readings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_mileage_readings
    ADD CONSTRAINT vehicle_mileage_readings_pkey PRIMARY KEY (id);


--
-- Name: worker_absences worker_absences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_absences
    ADD CONSTRAINT worker_absences_pkey PRIMARY KEY (id);


--
-- Name: worker_absences worker_absences_user_id_absence_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_absences
    ADD CONSTRAINT worker_absences_user_id_absence_date_key UNIQUE (user_id, absence_date);

alter table public.accounts add constraint accounts_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.attendance_sessions add constraint attendance_sessions_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.attendance_sessions add constraint attendance_sessions_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.attendance_sessions add constraint attendance_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public.card_statement_rows add constraint card_statement_rows_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE SET NULL;
alter table public.card_statement_rows add constraint card_statement_rows_income_payment_id_fkey FOREIGN KEY (income_payment_id) REFERENCES payments(id) ON DELETE SET NULL;
alter table public.card_statement_rows add constraint card_statement_rows_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.card_statement_rows add constraint card_statement_rows_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.card_statement_rows add constraint card_statement_rows_statement_id_fkey FOREIGN KEY (statement_id) REFERENCES card_statements(id) ON DELETE CASCADE;
alter table public.card_statements add constraint card_statements_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;
alter table public.card_statements add constraint card_statements_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.communication_logs add constraint communication_logs_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.communication_logs add constraint communication_logs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
alter table public.communication_logs add constraint communication_logs_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table public.communication_logs add constraint communication_logs_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;
alter table public.communication_logs add constraint communication_logs_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.communication_logs add constraint communication_logs_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.communication_logs add constraint communication_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
alter table public.contacts add constraint contacts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.document_links add constraint document_links_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;
alter table public.documents add constraint documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.entity_tags add constraint entity_tags_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.entity_tags add constraint entity_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE;
alter table public.expense_merchant_mappings add constraint expense_merchant_mappings_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.expense_merchant_mappings add constraint expense_merchant_mappings_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.expense_merchant_mappings add constraint expense_merchant_mappings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.expenses add constraint expenses_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
alter table public.expenses add constraint expenses_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table public.expenses add constraint expenses_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.expenses add constraint expenses_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.expenses add constraint expenses_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT;
alter table public.expenses add constraint expenses_recurring_expense_template_id_fkey FOREIGN KEY (recurring_expense_template_id) REFERENCES recurring_expense_templates(id) ON DELETE SET NULL;
alter table public.hourly_salary_overrides add constraint hourly_salary_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public.inventory add constraint inventory_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
alter table public.inventory_movements add constraint inventory_movements_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.inventory_movements add constraint inventory_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
alter table public.lease_agreements add constraint lease_agreements_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
alter table public.lease_agreements add constraint lease_agreements_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;
alter table public.lease_agreements add constraint lease_agreements_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE RESTRICT;
alter table public.loan_repayments add constraint loan_repayments_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
alter table public.loan_repayments add constraint loan_repayments_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.loan_repayments add constraint loan_repayments_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE;
alter table public.loans add constraint loans_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
alter table public.loans add constraint loans_counterparty_customer_id_fkey FOREIGN KEY (counterparty_customer_id) REFERENCES customers(id) ON DELETE SET NULL;
alter table public.loans add constraint loans_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.morning_documents add constraint morning_documents_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);
alter table public.morning_documents add constraint morning_documents_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id);
alter table public.morning_documents add constraint morning_documents_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES users(id);
alter table public.morning_documents add constraint morning_documents_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id);
alter table public.morning_documents add constraint morning_documents_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id);
alter table public.morning_documents add constraint morning_documents_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id);
alter table public.morning_settings add constraint morning_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id);
alter table public.order_items add constraint order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.order_items add constraint order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
alter table public.orders add constraint orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;
alter table public.orders add constraint orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
alter table public.payments add constraint payments_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
alter table public.payments add constraint payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table public.payments add constraint payments_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.payments add constraint payments_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.payments add constraint payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT;
alter table public.payslip_items add constraint payslip_items_payslip_id_fkey FOREIGN KEY (payslip_id) REFERENCES payslips(id) ON DELETE CASCADE;
alter table public.payslips add constraint payslips_payroll_period_id_fkey FOREIGN KEY (payroll_period_id) REFERENCES payroll_periods(id) ON DELETE RESTRICT;
alter table public.payslips add constraint payslips_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
alter table public.products add constraint products_category_id_fkey FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE RESTRICT;
alter table public.project_expenses add constraint project_expenses_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE RESTRICT;
alter table public.project_expenses add constraint project_expenses_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.projects add constraint projects_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
alter table public.projects add constraint projects_project_manager_id_fkey FOREIGN KEY (project_manager_id) REFERENCES users(id) ON DELETE SET NULL;
alter table public.push_subscriptions add constraint push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.recurring_expense_templates add constraint recurring_expense_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.recurring_expense_templates add constraint recurring_expense_templates_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table public.recurring_expense_templates add constraint recurring_expense_templates_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.recurring_expense_templates add constraint recurring_expense_templates_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.recurring_task_template_assignees add constraint recurring_task_template_assigne_recurring_task_template_id_fkey FOREIGN KEY (recurring_task_template_id) REFERENCES recurring_task_templates(id) ON DELETE CASCADE;
alter table public.recurring_task_template_assignees add constraint recurring_task_template_assignees_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public.recurring_task_templates add constraint recurring_task_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.recurring_task_templates add constraint recurring_task_templates_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.recurring_task_templates add constraint recurring_task_templates_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_communication_log_id_fkey FOREIGN KEY (communication_log_id) REFERENCES communication_logs(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.reminders add constraint reminders_reminder_user_id_fkey FOREIGN KEY (reminder_user_id) REFERENCES users(id) ON DELETE RESTRICT;
alter table public.reminders add constraint reminders_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.reminders add constraint reminders_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.salary_agreements add constraint salary_agreements_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;
alter table public.tags add constraint tags_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
alter table public.task_comments add constraint task_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL;
alter table public.task_comments add constraint task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.task_members add constraint task_members_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.task_members add constraint task_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public.tasks add constraint tasks_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL;
alter table public.tasks add constraint tasks_private_owner_id_fkey FOREIGN KEY (private_owner_id) REFERENCES users(id) ON DELETE SET NULL;
alter table public.tasks add constraint tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.tasks add constraint tasks_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
alter table public.tasks add constraint tasks_recurring_task_template_id_fkey FOREIGN KEY (recurring_task_template_id) REFERENCES recurring_task_templates(id) ON DELETE SET NULL;
alter table public.users add constraint users_auth_user_id_fk FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.vehicles add constraint vehicles_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE;
alter table public.worker_payment_allocations add constraint worker_payment_allocations_attendance_session_id_fkey FOREIGN KEY (attendance_session_id) REFERENCES attendance_sessions(id);
alter table public.worker_payment_allocations add constraint worker_payment_allocations_payslip_id_fkey FOREIGN KEY (payslip_id) REFERENCES payslips(id);
alter table public.worker_payment_allocations add constraint worker_payment_allocations_worker_payment_id_fkey FOREIGN KEY (worker_payment_id) REFERENCES worker_payments(id) ON DELETE CASCADE;
alter table public.worker_payments add constraint worker_payments_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
alter table public.worker_payments add constraint worker_payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES users(id);
alter table public.worker_payments add constraint worker_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
--
-- Name: account_transfers account_transfers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_transfers
    ADD CONSTRAINT account_transfers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: account_transfers account_transfers_from_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_transfers
    ADD CONSTRAINT account_transfers_from_account_id_fkey FOREIGN KEY (from_account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: account_transfers account_transfers_to_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_transfers
    ADD CONSTRAINT account_transfers_to_account_id_fkey FOREIGN KEY (to_account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: card_account_mappings card_account_mappings_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_account_mappings
    ADD CONSTRAINT card_account_mappings_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: card_account_mappings card_account_mappings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_account_mappings
    ADD CONSTRAINT card_account_mappings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: card_statement_charges card_statement_charges_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_statement_charges
    ADD CONSTRAINT card_statement_charges_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: card_statement_charges card_statement_charges_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_statement_charges
    ADD CONSTRAINT card_statement_charges_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: card_statement_charges card_statement_charges_statement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_statement_charges
    ADD CONSTRAINT card_statement_charges_statement_id_fkey FOREIGN KEY (statement_id) REFERENCES public.card_statements(id) ON DELETE CASCADE;


--
-- Name: customer_branches customer_branches_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_branches
    ADD CONSTRAINT customer_branches_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: fcm_tokens fcm_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fcm_tokens
    ADD CONSTRAINT fcm_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: order_delivery_recipients order_delivery_recipients_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_delivery_recipients
    ADD CONSTRAINT order_delivery_recipients_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_delivery_recipients order_delivery_recipients_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_delivery_recipients
    ADD CONSTRAINT order_delivery_recipients_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: phone_attendance_reports phone_attendance_reports_reported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_attendance_reports
    ADD CONSTRAINT phone_attendance_reports_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_sessions user_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: vehicle_mileage_readings vehicle_mileage_readings_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_mileage_readings
    ADD CONSTRAINT vehicle_mileage_readings_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: vehicle_mileage_readings vehicle_mileage_readings_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_mileage_readings
    ADD CONSTRAINT vehicle_mileage_readings_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: worker_absences worker_absences_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_absences
    ADD CONSTRAINT worker_absences_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: worker_absences worker_absences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_absences
    ADD CONSTRAINT worker_absences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- ===== indexes =====
--
-- Name: account_transfers_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_transfers_date_idx ON public.account_transfers USING btree (transfer_date);


--
-- Name: account_transfers_from_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_transfers_from_idx ON public.account_transfers USING btree (from_account_id);


--
-- Name: account_transfers_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_transfers_to_idx ON public.account_transfers USING btree (to_account_id);


--
-- Name: accounts_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounts_active_idx ON public.accounts USING btree (is_active);


--
-- Name: accounts_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounts_kind_idx ON public.accounts USING btree (kind);


--
-- Name: accounts_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounts_sort_idx ON public.accounts USING btree (sort_order);


--
-- Name: attendance_sessions_project_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attendance_sessions_project_user_idx ON public.attendance_sessions USING btree (project_id, user_id);


--
-- Name: audit_logs_changed_by_created_at_desc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_changed_by_created_at_desc_idx ON public.audit_logs USING btree (changed_by, created_at DESC);


--
-- Name: audit_logs_created_at_desc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_created_at_desc_idx ON public.audit_logs USING btree (created_at DESC);


--
-- Name: audit_logs_new_data_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_new_data_customer_id_idx ON public.audit_logs USING btree (table_name, ((new_data ->> 'customer_id'::text)));


--
-- Name: audit_logs_new_data_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_new_data_order_id_idx ON public.audit_logs USING btree (table_name, ((new_data ->> 'order_id'::text)));


--
-- Name: audit_logs_new_data_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_new_data_project_id_idx ON public.audit_logs USING btree (table_name, ((new_data ->> 'project_id'::text)));


--
-- Name: audit_logs_table_name_record_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_table_name_record_id_idx ON public.audit_logs USING btree (table_name, record_id);


--
-- Name: card_statement_charges_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX card_statement_charges_account_idx ON public.card_statement_charges USING btree (account_id);


--
-- Name: card_statement_charges_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX card_statement_charges_date_idx ON public.card_statement_charges USING btree (charge_date);


--
-- Name: card_statement_charges_statement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX card_statement_charges_statement_idx ON public.card_statement_charges USING btree (statement_id);


--
-- Name: card_statement_rows_card_label_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX card_statement_rows_card_label_idx ON public.card_statement_rows USING btree (card_label);


--
-- Name: card_statement_rows_expense_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX card_statement_rows_expense_idx ON public.card_statement_rows USING btree (expense_id);


--
-- Name: card_statement_rows_income_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX card_statement_rows_income_idx ON public.card_statement_rows USING btree (income_payment_id);


--
-- Name: card_statement_rows_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX card_statement_rows_order_idx ON public.card_statement_rows USING btree (statement_id, row_index, created_at);


--
-- Name: card_statement_rows_statement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX card_statement_rows_statement_idx ON public.card_statement_rows USING btree (statement_id);


--
-- Name: card_statements_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX card_statements_created_at_idx ON public.card_statements USING btree (created_at DESC);


--
-- Name: communication_logs_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX communication_logs_category_idx ON public.communication_logs USING btree (category, created_at DESC);


--
-- Name: communication_logs_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX communication_logs_customer_idx ON public.communication_logs USING btree (customer_id, created_at DESC);


--
-- Name: customer_branches_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_branches_customer_id_idx ON public.customer_branches USING btree (customer_id);


--
-- Name: customers_linked_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_linked_user_id_key ON public.customers USING btree (linked_user_id) WHERE (linked_user_id IS NOT NULL);


--
-- Name: customers_morning_client_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_morning_client_id_idx ON public.customers USING btree (morning_client_id);


--
-- Name: documents_business_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_business_domain_idx ON public.documents USING btree (business_domain);


--
-- Name: entity_tags_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entity_tags_entity_idx ON public.entity_tags USING btree (entity_type, entity_id);


--
-- Name: entity_tags_tag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entity_tags_tag_idx ON public.entity_tags USING btree (tag_id);


--
-- Name: expenses_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expenses_account_idx ON public.expenses USING btree (account_id);


--
-- Name: expenses_amount_transaction_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expenses_amount_transaction_date_idx ON public.expenses USING btree (amount, transaction_date);


--
-- Name: expenses_installment_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expenses_installment_group_idx ON public.expenses USING btree (installment_group_id) WHERE (installment_group_id IS NOT NULL);


--
-- Name: expenses_paid_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expenses_paid_date_idx ON public.expenses USING btree (paid_date);


--
-- Name: expenses_recorded_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expenses_recorded_by_idx ON public.expenses USING btree (recorded_by);


--
-- Name: expenses_recurring_template_key_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX expenses_recurring_template_key_uidx ON public.expenses USING btree (recurring_expense_template_id, recurrence_key) WHERE ((recurring_expense_template_id IS NOT NULL) AND (recurrence_key IS NOT NULL));


--
-- Name: fcm_tokens_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fcm_tokens_user_id_idx ON public.fcm_tokens USING btree (user_id);


--
-- Name: idempotency_keys_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idempotency_keys_created_at_idx ON public.idempotency_keys USING btree (created_at);


--
-- Name: idx_attendance_sessions_clock_in_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_sessions_clock_in_id ON public.attendance_sessions USING btree (clock_in DESC, id DESC);


--
-- Name: idx_attendance_sessions_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_sessions_project_id ON public.attendance_sessions USING btree (project_id);


--
-- Name: idx_attendance_sessions_property_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_sessions_property_id ON public.attendance_sessions USING btree (property_id);


--
-- Name: idx_attendance_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_sessions_user_id ON public.attendance_sessions USING btree (user_id);


--
-- Name: idx_card_statement_rows_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_card_statement_rows_project_id ON public.card_statement_rows USING btree (project_id);


--
-- Name: idx_card_statement_rows_property_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_card_statement_rows_property_id ON public.card_statement_rows USING btree (property_id);


--
-- Name: idx_card_statements_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_card_statements_document_id ON public.card_statements USING btree (document_id);


--
-- Name: idx_card_statements_imported_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_card_statements_imported_by ON public.card_statements USING btree (imported_by);


--
-- Name: idx_communication_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_logs_created_at ON public.communication_logs USING btree (created_at DESC);


--
-- Name: idx_communication_logs_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_logs_created_by ON public.communication_logs USING btree (created_by);


--
-- Name: idx_communication_logs_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_logs_customer_id ON public.communication_logs USING btree (customer_id);


--
-- Name: idx_communication_logs_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_logs_order_id ON public.communication_logs USING btree (order_id);


--
-- Name: idx_communication_logs_payment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_logs_payment_id ON public.communication_logs USING btree (payment_id);


--
-- Name: idx_communication_logs_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_logs_project_id ON public.communication_logs USING btree (project_id);


--
-- Name: idx_communication_logs_property_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_logs_property_id ON public.communication_logs USING btree (property_id);


--
-- Name: idx_communication_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communication_logs_user_id ON public.communication_logs USING btree (user_id);


--
-- Name: idx_contacts_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_customer_id ON public.contacts USING btree (customer_id);


--
-- Name: idx_contacts_email_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_email_trgm ON public.contacts USING gin (email public.gin_trgm_ops);


--
-- Name: idx_contacts_full_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_full_name_trgm ON public.contacts USING gin (full_name public.gin_trgm_ops);


--
-- Name: idx_contacts_phone_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_phone_trgm ON public.contacts USING gin (phone public.gin_trgm_ops);


--
-- Name: idx_contacts_whatsapp_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_whatsapp_trgm ON public.contacts USING gin (whatsapp public.gin_trgm_ops);


--
-- Name: idx_customers_address_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_address_trgm ON public.customers USING gin (address public.gin_trgm_ops);


--
-- Name: idx_customers_email_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_email_trgm ON public.customers USING gin (email public.gin_trgm_ops);


--
-- Name: idx_customers_name_for_invoice_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_name_for_invoice_trgm ON public.customers USING gin (name_for_invoice public.gin_trgm_ops);


--
-- Name: idx_customers_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_name_trgm ON public.customers USING gin (name public.gin_trgm_ops);


--
-- Name: idx_customers_phone_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_phone_trgm ON public.customers USING gin (phone public.gin_trgm_ops);


--
-- Name: idx_customers_whatsapp_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_whatsapp_trgm ON public.customers USING gin (whatsapp public.gin_trgm_ops);


--
-- Name: idx_document_links_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_links_document_id ON public.document_links USING btree (document_id);


--
-- Name: idx_documents_uploaded_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_uploaded_by ON public.documents USING btree (uploaded_by);


--
-- Name: idx_expense_merchant_mappings_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_merchant_mappings_project_id ON public.expense_merchant_mappings USING btree (project_id);


--
-- Name: idx_expense_merchant_mappings_property_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_merchant_mappings_property_id ON public.expense_merchant_mappings USING btree (property_id);


--
-- Name: idx_expense_merchant_mappings_updated_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_merchant_mappings_updated_by ON public.expense_merchant_mappings USING btree (updated_by);


--
-- Name: idx_expenses_expense_date_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_expense_date_id ON public.expenses USING btree (expense_date DESC, id DESC);


--
-- Name: idx_expenses_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_order_id ON public.expenses USING btree (order_id);


--
-- Name: idx_expenses_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_project_id ON public.expenses USING btree (project_id);


--
-- Name: idx_expenses_property_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_property_id ON public.expenses USING btree (property_id);


--
-- Name: idx_expenses_recorded_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_recorded_by ON public.expenses USING btree (recorded_by);


--
-- Name: idx_hourly_salary_overrides_end_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hourly_salary_overrides_end_time ON public.hourly_salary_overrides USING btree (end_time);


--
-- Name: idx_hourly_salary_overrides_start_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hourly_salary_overrides_start_time ON public.hourly_salary_overrides USING btree (start_time);


--
-- Name: idx_hourly_salary_overrides_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hourly_salary_overrides_user_id ON public.hourly_salary_overrides USING btree (user_id);


--
-- Name: idx_inventory_movements_performed_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_performed_by ON public.inventory_movements USING btree (performed_by);


--
-- Name: idx_inventory_movements_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_product_id ON public.inventory_movements USING btree (product_id);


--
-- Name: idx_lease_agreements_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lease_agreements_customer_id ON public.lease_agreements USING btree (customer_id);


--
-- Name: idx_lease_agreements_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lease_agreements_document_id ON public.lease_agreements USING btree (document_id);


--
-- Name: idx_lease_agreements_property_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lease_agreements_property_id ON public.lease_agreements USING btree (property_id);


--
-- Name: idx_loan_repayments_repayment_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loan_repayments_repayment_date ON public.loan_repayments USING btree (repayment_date);


--
-- Name: idx_loans_loan_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loans_loan_date ON public.loans USING btree (loan_date DESC);


--
-- Name: idx_morning_documents_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_morning_documents_document_id ON public.morning_documents USING btree (document_id);


--
-- Name: idx_morning_documents_issued_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_morning_documents_issued_by ON public.morning_documents USING btree (issued_by);


--
-- Name: idx_morning_settings_updated_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_morning_settings_updated_by ON public.morning_settings USING btree (updated_by);


--
-- Name: idx_order_items_notes_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_notes_trgm ON public.order_items USING gin (notes public.gin_trgm_ops);


--
-- Name: idx_order_items_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_product_id ON public.order_items USING btree (product_id);


--
-- Name: idx_orders_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created_at ON public.orders USING btree (created_at);


--
-- Name: idx_orders_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created_by ON public.orders USING btree (created_by);


--
-- Name: idx_orders_customer_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_customer_date ON public.orders USING btree (customer_id, created_at);


--
-- Name: idx_orders_notes_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_notes_trgm ON public.orders USING gin (notes public.gin_trgm_ops);


--
-- Name: idx_payments_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_date ON public.payments USING btree (payment_date);


--
-- Name: idx_payments_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_order_id ON public.payments USING btree (order_id);


--
-- Name: idx_payments_payment_date_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_payment_date_id ON public.payments USING btree (payment_date DESC, id DESC);


--
-- Name: idx_payments_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_project_id ON public.payments USING btree (project_id);


--
-- Name: idx_payments_property_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_property_id ON public.payments USING btree (property_id);


--
-- Name: idx_payments_recorded_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_recorded_by ON public.payments USING btree (recorded_by);


--
-- Name: idx_payslip_items_item_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payslip_items_item_type ON public.payslip_items USING btree (item_type);


--
-- Name: idx_payslip_items_payslip_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payslip_items_payslip_id ON public.payslip_items USING btree (payslip_id);


--
-- Name: idx_payslips_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payslips_user_id ON public.payslips USING btree (user_id);


--
-- Name: idx_products_barcode_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_barcode_trgm ON public.products USING gin (barcode public.gin_trgm_ops);


--
-- Name: idx_products_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_category_id ON public.products USING btree (category_id);


--
-- Name: idx_products_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_name_trgm ON public.products USING gin (name public.gin_trgm_ops);


--
-- Name: idx_products_sku_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_sku_trgm ON public.products USING gin (sku public.gin_trgm_ops);


--
-- Name: idx_projects_created_at_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_created_at_id ON public.projects USING btree (created_at DESC, id DESC);


--
-- Name: idx_projects_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_customer_id ON public.projects USING btree (customer_id);


--
-- Name: idx_projects_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_name_trgm ON public.projects USING gin (name public.gin_trgm_ops);


--
-- Name: idx_projects_notes_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_notes_trgm ON public.projects USING gin (notes public.gin_trgm_ops);


--
-- Name: idx_projects_project_manager_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_project_manager_id ON public.projects USING btree (project_manager_id);


--
-- Name: idx_projects_start_date_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_start_date_desc ON public.projects USING btree (start_date DESC);


--
-- Name: idx_projects_updated_at_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_updated_at_desc ON public.projects USING btree (updated_at DESC);


--
-- Name: idx_recurring_expense_templates_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurring_expense_templates_created_by ON public.recurring_expense_templates USING btree (created_by);


--
-- Name: idx_recurring_task_templates_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurring_task_templates_created_by ON public.recurring_task_templates USING btree (created_by);


--
-- Name: idx_recurring_task_templates_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurring_task_templates_project_id ON public.recurring_task_templates USING btree (project_id);


--
-- Name: idx_recurring_task_templates_property_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurring_task_templates_property_id ON public.recurring_task_templates USING btree (property_id);


--
-- Name: idx_reminders_communication_log_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_communication_log_id ON public.reminders USING btree (communication_log_id);


--
-- Name: idx_reminders_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_created_by ON public.reminders USING btree (created_by);


--
-- Name: idx_reminders_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_customer_id ON public.reminders USING btree (customer_id);


--
-- Name: idx_reminders_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_order_id ON public.reminders USING btree (order_id);


--
-- Name: idx_reminders_payment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_payment_id ON public.reminders USING btree (payment_id);


--
-- Name: idx_reminders_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_project_id ON public.reminders USING btree (project_id);


--
-- Name: idx_reminders_property_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_property_id ON public.reminders USING btree (property_id);


--
-- Name: idx_reminders_reminder_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_reminder_at ON public.reminders USING btree (reminder_at);


--
-- Name: idx_reminders_reminder_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_reminder_user_id ON public.reminders USING btree (reminder_user_id);


--
-- Name: idx_reminders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_status ON public.reminders USING btree (status);


--
-- Name: idx_reminders_updated_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminders_updated_by ON public.reminders USING btree (updated_by);


--
-- Name: idx_salary_agreements_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_salary_agreements_user_id ON public.salary_agreements USING btree (user_id);


--
-- Name: idx_task_comments_author_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_comments_author_id ON public.task_comments USING btree (author_id);


--
-- Name: idx_task_comments_body_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_comments_body_trgm ON public.task_comments USING gin (body public.gin_trgm_ops);


--
-- Name: idx_tasks_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_assignee ON public.tasks USING btree (assigned_user_id);


--
-- Name: idx_tasks_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_customer_id ON public.tasks USING btree (customer_id);


--
-- Name: idx_tasks_description_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_description_trgm ON public.tasks USING gin (description public.gin_trgm_ops);


--
-- Name: idx_tasks_private_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_private_owner ON public.tasks USING btree (private_owner_id) WHERE is_private;


--
-- Name: idx_tasks_property_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_property_id ON public.tasks USING btree (property_id);


--
-- Name: idx_tasks_status_sort_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_status_sort_order ON public.tasks USING btree (status, sort_order);


--
-- Name: idx_tasks_subject_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_subject_trgm ON public.tasks USING gin (subject public.gin_trgm_ops);


--
-- Name: idx_user_sessions_last_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions_last_seen ON public.user_sessions USING btree (last_seen_at DESC);


--
-- Name: idx_user_sessions_user_last_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions_user_last_seen ON public.user_sessions USING btree (user_id, last_seen_at DESC);


--
-- Name: idx_users_last_seen_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_last_seen_at ON public.users USING btree (last_seen_at);


--
-- Name: idx_worker_payment_allocations_attendance_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_payment_allocations_attendance_session_id ON public.worker_payment_allocations USING btree (attendance_session_id);


--
-- Name: idx_worker_payment_allocations_payslip_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_payment_allocations_payslip_id ON public.worker_payment_allocations USING btree (payslip_id);


--
-- Name: idx_worker_payment_allocations_worker_payment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_payment_allocations_worker_payment_id ON public.worker_payment_allocations USING btree (worker_payment_id);


--
-- Name: idx_worker_payments_recorded_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_payments_recorded_by ON public.worker_payments USING btree (recorded_by);


--
-- Name: idx_worker_payments_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_worker_payments_user_id ON public.worker_payments USING btree (user_id);


--
-- Name: loan_repayments_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loan_repayments_account_idx ON public.loan_repayments USING btree (account_id);


--
-- Name: loan_repayments_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loan_repayments_date_idx ON public.loan_repayments USING btree (repayment_date DESC);


--
-- Name: loan_repayments_loan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loan_repayments_loan_idx ON public.loan_repayments USING btree (loan_id);


--
-- Name: loan_repayments_status_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loan_repayments_status_date_idx ON public.loan_repayments USING btree (status, repayment_date);


--
-- Name: loans_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loans_account_idx ON public.loans USING btree (account_id);


--
-- Name: loans_counterparty_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loans_counterparty_idx ON public.loans USING btree (counterparty_customer_id);


--
-- Name: loans_direction_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loans_direction_idx ON public.loans USING btree (direction);


--
-- Name: loans_loan_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loans_loan_date_idx ON public.loans USING btree (loan_date DESC);


--
-- Name: loans_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loans_status_idx ON public.loans USING btree (status);


--
-- Name: morning_documents_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX morning_documents_customer_id_idx ON public.morning_documents USING btree (customer_id);


--
-- Name: morning_documents_morning_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX morning_documents_morning_document_id_idx ON public.morning_documents USING btree (morning_document_id);


--
-- Name: morning_documents_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX morning_documents_order_id_idx ON public.morning_documents USING btree (order_id);


--
-- Name: morning_documents_payment_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX morning_documents_payment_id_idx ON public.morning_documents USING btree (payment_id);


--
-- Name: morning_documents_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX morning_documents_project_id_idx ON public.morning_documents USING btree (project_id);


--
-- Name: notifications_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_unread_idx ON public.notifications USING btree (user_id) WHERE (read_at IS NULL);


--
-- Name: notifications_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_idx ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: order_items_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_items_order_id_idx ON public.order_items USING btree (order_id);


--
-- Name: order_items_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_items_product_id_idx ON public.order_items USING btree (product_id);


--
-- Name: orders_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_customer_id_idx ON public.orders USING btree (customer_id);


--
-- Name: orders_needs_invoice_unsent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_needs_invoice_unsent_idx ON public.orders USING btree (needs_invoice) WHERE (invoice_sent_at IS NULL);


--
-- Name: orders_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_status_idx ON public.orders USING btree (status);


--
-- Name: payment_promises_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_promises_customer_idx ON public.payment_promises USING btree (customer_id);


--
-- Name: payment_promises_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_promises_open_idx ON public.payment_promises USING btree (promised_date) WHERE (status = 'pending'::text);


--
-- Name: payments_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_account_idx ON public.payments USING btree (account_id);


--
-- Name: payments_check_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_check_number_idx ON public.payments USING btree (check_number);


--
-- Name: payments_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_order_id_idx ON public.payments USING btree (order_id);


--
-- Name: payslip_items_unattached_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payslip_items_unattached_idx ON public.payslip_items USING btree (user_id, item_date) WHERE (payslip_id IS NULL);


--
-- Name: payslip_items_user_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payslip_items_user_date_idx ON public.payslip_items USING btree (user_id, item_date DESC);


--
-- Name: phone_attendance_reports_one_open_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX phone_attendance_reports_one_open_per_user ON public.phone_attendance_reports USING btree (user_id) WHERE (status = 'open'::text);


--
-- Name: phone_attendance_reports_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX phone_attendance_reports_pending_idx ON public.phone_attendance_reports USING btree (created_at) WHERE (status = 'pending_review'::text);


--
-- Name: phone_attendance_reports_provider_call_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX phone_attendance_reports_provider_call_idx ON public.phone_attendance_reports USING btree (provider_call_id) WHERE (provider_call_id IS NOT NULL);


--
-- Name: phone_attendance_reports_reported_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX phone_attendance_reports_reported_by_idx ON public.phone_attendance_reports USING btree (reported_by) WHERE (reported_by IS NOT NULL);


--
-- Name: phone_attendance_reports_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX phone_attendance_reports_user_idx ON public.phone_attendance_reports USING btree (user_id, clock_in DESC);


--
-- Name: project_expenses_expense_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_expenses_expense_id_idx ON public.project_expenses USING btree (expense_id);


--
-- Name: project_expenses_expense_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_expenses_expense_idx ON public.project_expenses USING btree (expense_id);


--
-- Name: project_expenses_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_expenses_project_id_idx ON public.project_expenses USING btree (project_id);


--
-- Name: project_expenses_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_expenses_project_idx ON public.project_expenses USING btree (project_id);


--
-- Name: projects_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX projects_status_idx ON public.projects USING btree (status);


-- push_alert_config_rule_key_uniq: not created here, same reason as the
-- column backfill note above — rule_key doesn't exist until the reshape
-- migration runs, and that column's own later migration (20260702050000_
-- unify_alert_config.sql) creates this exact index itself.

--
-- Name: recurring_expense_templates_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_expense_templates_account_idx ON public.recurring_expense_templates USING btree (account_id);


--
-- Name: recurring_expense_templates_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_expense_templates_active_idx ON public.recurring_expense_templates USING btree (is_active, frequency, create_day_of_month);


--
-- Name: recurring_expense_templates_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_expense_templates_domain_idx ON public.recurring_expense_templates USING btree (business_domain);


--
-- Name: recurring_expense_templates_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_expense_templates_order_idx ON public.recurring_expense_templates USING btree (order_id);


--
-- Name: recurring_expense_templates_project_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_expense_templates_project_idx ON public.recurring_expense_templates USING btree (project_id);


--
-- Name: recurring_expense_templates_property_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_expense_templates_property_idx ON public.recurring_expense_templates USING btree (property_id);


--
-- Name: recurring_task_template_assignees_template_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_task_template_assignees_template_idx ON public.recurring_task_template_assignees USING btree (recurring_task_template_id);


--
-- Name: recurring_task_template_assignees_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_task_template_assignees_user_idx ON public.recurring_task_template_assignees USING btree (user_id);


--
-- Name: recurring_task_templates_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_task_templates_active_idx ON public.recurring_task_templates USING btree (is_active, frequency, create_day_of_month);


--
-- Name: recurring_task_templates_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_task_templates_domain_idx ON public.recurring_task_templates USING btree (business_domain);


--
-- Name: reminders_assigned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminders_assigned_idx ON public.reminders USING btree (assigned_to, status, remind_at);


--
-- Name: reminders_audience_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminders_audience_idx ON public.reminders USING btree (audience_role, status) WHERE (audience_role IS NOT NULL);


--
-- Name: reminders_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminders_customer_idx ON public.reminders USING btree (customer_id, remind_at);


--
-- Name: reminders_dedupe_open_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reminders_dedupe_open_uniq ON public.reminders USING btree (dedupe_key) WHERE ((source = 'system'::text) AND (status = 'pending'::text) AND (dedupe_key IS NOT NULL));


--
-- Name: reminders_due_unsent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminders_due_unsent_idx ON public.reminders USING btree (status, remind_at) WHERE (notified_at IS NULL);


--
-- Name: reminders_next_ping_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminders_next_ping_idx ON public.reminders USING btree (next_ping_at) WHERE ((status = 'pending'::text) AND (next_ping_at IS NOT NULL));


--
-- Name: reminders_status_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminders_status_due_idx ON public.reminders USING btree (status, remind_at);


--
-- Name: reminders_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminders_task_idx ON public.reminders USING btree (task_id);


--
-- Name: reminders_worklist_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminders_worklist_idx ON public.reminders USING btree (assigned_to, status);


--
-- Name: tags_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tags_active_idx ON public.tags USING btree (is_active);


--
-- Name: tags_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tags_kind_idx ON public.tags USING btree (kind);


--
-- Name: task_comments_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_comments_task_idx ON public.task_comments USING btree (task_id, created_at);


--
-- Name: task_members_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_members_task_idx ON public.task_members USING btree (task_id);


--
-- Name: task_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_members_user_idx ON public.task_members USING btree (user_id);


--
-- Name: tasks_assigned_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_assigned_user_id_idx ON public.tasks USING btree (assigned_user_id);


--
-- Name: tasks_project_assigned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_project_assigned_idx ON public.tasks USING btree (project_id, assigned_user_id);


--
-- Name: tasks_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_project_id_idx ON public.tasks USING btree (project_id);


--
-- Name: tasks_recurring_template_key_assignee_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tasks_recurring_template_key_assignee_uidx ON public.tasks USING btree (recurring_task_template_id, recurrence_key, assigned_user_id) WHERE ((recurring_task_template_id IS NOT NULL) AND (recurrence_key IS NOT NULL));


--
-- Name: users_auth_user_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_auth_user_id_unique ON public.users USING btree (auth_user_id) WHERE (auth_user_id IS NOT NULL);


--
-- Name: vehicle_mileage_readings_tag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vehicle_mileage_readings_tag_idx ON public.vehicle_mileage_readings USING btree (tag_id, recorded_at DESC, created_at DESC);


--
-- Name: vehicles_insurance_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vehicles_insurance_due_idx ON public.vehicles USING btree (insurance_due_date);


--
-- Name: vehicles_license_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vehicles_license_due_idx ON public.vehicles USING btree (license_due_date);


--
-- Name: vehicles_photo_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vehicles_photo_document_idx ON public.vehicles USING btree (photo_document_id);


--
-- Name: vehicles_tag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vehicles_tag_idx ON public.vehicles USING btree (tag_id);


--
-- Name: vehicles_test_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vehicles_test_due_idx ON public.vehicles USING btree (test_due_date);


--
-- Name: worker_absences_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_absences_date_idx ON public.worker_absences USING btree (absence_date);


--
-- Name: worker_absences_user_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_absences_user_date_idx ON public.worker_absences USING btree (user_id, absence_date DESC);


--
-- Name: worker_payments_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX worker_payments_account_idx ON public.worker_payments USING btree (account_id);

-- ===== functions =====
--
-- Name: recurring_expense_apply_tokens(text, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recurring_expense_apply_tokens(p_value text, p_period_key text, p_expense_date date) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select
    case
      when p_value is null then null
      else replace(
        replace(
          replace(
            p_value,
            '{{period_key}}',
            p_period_key
          ),
          '{{expense_date}}',
          to_char(p_expense_date, 'YYYY-MM-DD')
        ),
        '{{expense_month}}',
        to_char(p_expense_date, 'YYYY-MM')
      )
    end
$$;


--
-- Name: _ensure_recurring_occurrence(public.recurring_expense_templates, text, date, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._ensure_recurring_occurrence(t public.recurring_expense_templates, p_key text, p_expense_date date, p_paid boolean) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
declare
  v_expense_id uuid;
begin
  if t.start_date is not null and p_expense_date < t.start_date then
    return false;
  end if;
  if t.end_date is not null and p_expense_date > t.end_date then
    return false;
  end if;
  if exists (
    select 1 from public.expenses e
    where e.recurring_expense_template_id = t.id and e.recurrence_key = p_key
  ) then
    return false;
  end if;

  insert into public.expenses (
    expense_date, amount, category, description, business_domain,
    project_id, order_id, property_id, account_id, notes, recorded_by,
    recurring_expense_template_id, recurrence_key, payment_status, paid_amount, paid_date
  )
  values (
    p_expense_date, t.amount, t.category,
    public.recurring_expense_apply_tokens(t.description_template, p_key, p_expense_date),
    -- The template stores the domain as text; expenses.business_domain is an enum,
    -- and a text VARIABLE won't implicitly cast to it inside PL/pgSQL (only bare
    -- string literals do — which is why the old inline generator silently failed).
    coalesce(t.business_domain, 'general_business')::public.business_domain_enum, t.project_id, t.order_id, t.property_id, t.account_id,
    public.recurring_expense_apply_tokens(t.notes_template, p_key, p_expense_date),
    t.created_by, t.id, p_key,
    case when p_paid then 'paid' else 'not_paid' end,
    case when p_paid then t.amount else 0 end,
    case when p_paid then p_expense_date else null end
  )
  returning id into v_expense_id;

  if t.project_id is not null then
    insert into public.project_expenses (project_id, expense_id, included_in_base_price, billed_to_customer, notes)
    values (
      t.project_id, v_expense_id, t.included_in_base_price, t.billed_to_customer,
      public.recurring_expense_apply_tokens(t.project_expense_notes_template, p_key, p_expense_date)
    );
  end if;

  return true;
end;
$$;


--
-- Name: account_picker_options(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.account_picker_options() RETURNS TABLE(id uuid, name text, kind text, is_active boolean, sort_order integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select a.id, a.name, a.kind, a.is_active, a.sort_order
  from public.accounts a
  where a.is_active = true
    and exists (
      select 1 from public.users u
      where u.auth_user_id = (select auth.uid())
        and u.active = true
        and coalesce(u.system_access, false) = true
        and (
          u.role = any (array['admin'::user_role_enum, 'office'::user_role_enum])
          or (u.role = 'worker'::user_role_enum and coalesce((u.section_access->>'vehicles')::boolean, false))
        )
    )
  order by a.sort_order, a.name;
$$;


--
-- Name: admin_upsert_user_profile(uuid, uuid, text, text, text, text, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_upsert_user_profile(p_user_id uuid DEFAULT NULL::uuid, p_auth_user_id uuid DEFAULT NULL::uuid, p_full_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_role text DEFAULT 'worker'::text, p_active boolean DEFAULT true, p_system_access boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id uuid;
  v_role public.user_role_enum;
begin
  if nullif(trim(coalesce(p_full_name, '')), '') is null then
    raise exception 'full_name is required';
  end if;

  begin
    v_role := coalesce(nullif(trim(coalesce(p_role, '')), ''), 'worker')::public.user_role_enum;
  exception
    when invalid_text_representation then
      raise exception 'invalid role';
  end;

  if p_user_id is not null then
    update public.users
    set auth_user_id = p_auth_user_id,
        full_name = nullif(trim(coalesce(p_full_name, '')), ''),
        email = nullif(trim(coalesce(lower(p_email), '')), ''),
        phone = nullif(trim(coalesce(p_phone, '')), ''),
        role = v_role,
        active = coalesce(p_active, true),
        system_access = coalesce(p_system_access, false)
    where id = p_user_id
    returning id into v_user_id;
  elsif nullif(trim(coalesce(p_email, '')), '') is not null then
    update public.users
    set auth_user_id = p_auth_user_id,
        full_name = nullif(trim(coalesce(p_full_name, '')), ''),
        phone = nullif(trim(coalesce(p_phone, '')), ''),
        role = v_role,
        active = coalesce(p_active, true),
        system_access = coalesce(p_system_access, false)
    where email = nullif(trim(coalesce(lower(p_email), '')), '')
    returning id into v_user_id;
  end if;

  if v_user_id is null then
    insert into public.users (
      auth_user_id,
      full_name,
      email,
      phone,
      role,
      active,
      system_access
    ) values (
      p_auth_user_id,
      nullif(trim(coalesce(p_full_name, '')), ''),
      nullif(trim(coalesce(lower(p_email), '')), ''),
      nullif(trim(coalesce(p_phone, '')), ''),
      v_role,
      coalesce(p_active, true),
      coalesce(p_system_access, false)
    )
    returning id into v_user_id;
  end if;

  return v_user_id;
end;
$$;


--
-- Name: admin_upsert_user_profile(uuid, uuid, text, text, text, text, boolean, boolean, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_upsert_user_profile(p_user_id uuid DEFAULT NULL::uuid, p_auth_user_id uuid DEFAULT NULL::uuid, p_full_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_role text DEFAULT 'worker'::text, p_active boolean DEFAULT true, p_system_access boolean DEFAULT false, p_payroll_worker_type text DEFAULT NULL::text, p_pay_tracking_mode text DEFAULT 'session'::text, p_locale text DEFAULT NULL::text, p_section_access jsonb DEFAULT NULL::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user_id uuid;
  v_role public.user_role_enum;
  v_payroll_worker_type text;
  v_pay_tracking_mode text;
  v_locale text;
begin
  if nullif(trim(coalesce(p_full_name, '')), '') is null then
    raise exception 'full_name is required';
  end if;

  begin
    v_role := coalesce(nullif(trim(coalesce(p_role, '')), ''), 'worker')::public.user_role_enum;
  exception
    when invalid_text_representation then
      raise exception 'invalid role';
  end;

  v_payroll_worker_type := case
    when coalesce(nullif(trim(coalesce(p_payroll_worker_type, '')), ''), '') = 'monthly_payslip' then 'monthly_payslip'
    when coalesce(nullif(trim(coalesce(p_payroll_worker_type, '')), ''), '') = 'hourly_payslip' then 'hourly_payslip'
    when coalesce(nullif(trim(coalesce(p_payroll_worker_type, '')), ''), '') = 'session_only' then 'session_only'
    when coalesce(nullif(trim(coalesce(p_pay_tracking_mode, '')), ''), 'session') = 'payslip' then 'monthly_payslip'
    else 'session_only'
  end;

  v_pay_tracking_mode := case
    when v_payroll_worker_type = 'session_only' then 'session'
    else 'payslip'
  end;

  -- Only 'he'/'ar' are ever valid; anything else (including null/omitted)
  -- means "leave it as it is" rather than a silent reset.
  v_locale := case when p_locale in ('he', 'ar') then p_locale else null end;

  if p_user_id is not null then
    update public.users
    set auth_user_id = p_auth_user_id,
        full_name = nullif(trim(coalesce(p_full_name, '')), ''),
        email = nullif(trim(coalesce(lower(p_email), '')), ''),
        phone = nullif(trim(coalesce(p_phone, '')), ''),
        role = v_role,
        active = coalesce(p_active, true),
        system_access = coalesce(p_system_access, false),
        payroll_worker_type = v_payroll_worker_type,
        pay_tracking_mode = v_pay_tracking_mode,
        locale = coalesce(v_locale, locale),
        section_access = coalesce(p_section_access, section_access)
    where id = p_user_id
    returning id into v_user_id;
  elsif nullif(trim(coalesce(p_email, '')), '') is not null then
    update public.users
    set auth_user_id = p_auth_user_id,
        full_name = nullif(trim(coalesce(p_full_name, '')), ''),
        phone = nullif(trim(coalesce(p_phone, '')), ''),
        role = v_role,
        active = coalesce(p_active, true),
        system_access = coalesce(p_system_access, false),
        payroll_worker_type = v_payroll_worker_type,
        pay_tracking_mode = v_pay_tracking_mode,
        locale = coalesce(v_locale, locale),
        section_access = coalesce(p_section_access, section_access)
    where email = nullif(trim(coalesce(lower(p_email), '')), '')
    returning id into v_user_id;
  end if;

  if v_user_id is null then
    insert into public.users (
      auth_user_id,
      full_name,
      email,
      phone,
      role,
      active,
      system_access,
      payroll_worker_type,
      pay_tracking_mode,
      locale,
      section_access
    ) values (
      p_auth_user_id,
      nullif(trim(coalesce(p_full_name, '')), ''),
      nullif(trim(coalesce(lower(p_email), '')), ''),
      nullif(trim(coalesce(p_phone, '')), ''),
      v_role,
      coalesce(p_active, true),
      coalesce(p_system_access, false),
      v_payroll_worker_type,
      v_pay_tracking_mode,
      coalesce(v_locale, 'he'),
      coalesce(
        p_section_access,
        '{"dashboard":true,"tasks":true,"calendar":true,"deliveries":true,"vehicles":false}'::jsonb
      )
    )
    returning id into v_user_id;
  end if;

  return v_user_id;
end;
$$;


--
-- Name: apply_inventory_movement_delta(uuid, text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_inventory_movement_delta(p_product_id uuid, p_movement_type text, p_quantity numeric) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  v_delta numeric;
begin
  if p_product_id is null or p_quantity is null then
    return;
  end if;

  -- Normalize delta by movement type.
  v_delta := case
    when lower(coalesce(p_movement_type, '')) = 'out' then -abs(p_quantity)
    else abs(p_quantity)
  end;

  insert into public.inventory (product_id, quantity_on_hand, quantity_reserved, updated_at)
  values (p_product_id, v_delta, 0, now())
  on conflict (product_id) do update
    set quantity_on_hand = coalesce(public.inventory.quantity_on_hand, 0) + v_delta,
        updated_at = now();
end;
$$;


--
-- Name: apply_inventory_movement_delta(uuid, text, numeric, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_inventory_movement_delta(p_product_id uuid, p_movement_type text, p_quantity numeric, p_sign integer DEFAULT 1) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  v_type text;
  v_qty numeric;
  v_on_hand_delta numeric := 0;
  v_reserved_delta numeric := 0;
  v_current_on_hand numeric := 0;
  v_current_reserved numeric := 0;
  v_next_on_hand numeric := 0;
  v_next_reserved numeric := 0;
begin
  if p_product_id is null or p_quantity is null then
    return;
  end if;

  v_type := lower(coalesce(trim(p_movement_type), ''));
  v_qty := coalesce(p_quantity, 0);

  case v_type
    when 'in' then
      v_on_hand_delta := abs(v_qty) * p_sign;
    when 'out' then
      v_on_hand_delta := -abs(v_qty) * p_sign;
    when 'reserve' then
      v_reserved_delta := abs(v_qty) * p_sign;
    when 'release' then
      v_reserved_delta := -abs(v_qty) * p_sign;
    when 'adjustment' then
      v_on_hand_delta := v_qty * p_sign;
    else
      raise exception 'Unsupported movement_type: %', p_movement_type;
  end case;

  select coalesce(quantity_on_hand,0), coalesce(quantity_reserved,0)
    into v_current_on_hand, v_current_reserved
  from public.inventory
  where product_id = p_product_id
  for update;

  if not found then
    v_current_on_hand := 0;
    v_current_reserved := 0;
  end if;

  v_next_on_hand := v_current_on_hand + v_on_hand_delta;
  v_next_reserved := greatest(0, v_current_reserved + v_reserved_delta);

  if v_next_on_hand < 0 then
    raise exception 'Inventory cannot be negative for product %', p_product_id;
  end if;

  if v_next_reserved > v_next_on_hand then
    raise exception 'Reserved quantity cannot exceed available stock for product %', p_product_id;
  end if;

  insert into public.inventory (product_id, quantity_on_hand, quantity_reserved, updated_at)
  values (p_product_id, v_next_on_hand, v_next_reserved, now())
  on conflict (product_id) do update
    set quantity_on_hand = excluded.quantity_on_hand,
        quantity_reserved = excluded.quantity_reserved,
        updated_at = now();
end;
$$;


--
-- Name: apply_inventory_movement_effect(uuid, text, numeric, integer, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_inventory_movement_effect(p_product_id uuid, p_movement_type text, p_quantity numeric, p_sign integer DEFAULT 1, p_check_guard boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  v_type text;
  v_qty numeric;
  v_on_hand_delta numeric := 0;
  v_reserved_delta numeric := 0;
begin
  if p_product_id is null or p_quantity is null then
    return;
  end if;

  v_type := lower(coalesce(trim(p_movement_type), ''));
  v_qty := coalesce(p_quantity, 0);

  case v_type
    when 'in' then
      v_on_hand_delta := abs(v_qty) * p_sign;
    when 'out' then
      v_on_hand_delta := -abs(v_qty) * p_sign;
    when 'reserve' then
      v_reserved_delta := abs(v_qty) * p_sign;
    when 'release' then
      v_reserved_delta := -abs(v_qty) * p_sign;
    when 'adjustment' then
      -- Adjustment quantity is signed as-is.
      v_on_hand_delta := v_qty * p_sign;
    else
      raise exception 'Unsupported movement_type: %', p_movement_type;
  end case;

  insert into public.inventory (product_id, quantity_on_hand, quantity_reserved, updated_at)
  values (p_product_id, v_on_hand_delta, v_reserved_delta, now())
  on conflict (product_id) do update
    set quantity_on_hand = coalesce(public.inventory.quantity_on_hand, 0) + v_on_hand_delta,
        quantity_reserved = greatest(
          0,
          coalesce(public.inventory.quantity_reserved, 0) + v_reserved_delta
        ),
        updated_at = now();

  -- Guard rail: never allow negative on-hand by mistake (skipped on the revert
  -- leg of an UPDATE — only the final state is validated).
  if p_check_guard and exists (
    select 1
    from public.inventory i
    where i.product_id = p_product_id
      and coalesce(i.quantity_on_hand, 0) < 0
  ) then
    raise exception 'Inventory cannot be negative for product %', p_product_id;
  end if;
end;
$$;


--
-- Name: recurring_expense_clamped_date(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recurring_expense_clamped_date(p_year integer, p_month integer, p_day integer) RETURNS date
    LANGUAGE sql IMMUTABLE
    AS $$
  select make_date(
    p_year,
    p_month,
    least(
      greatest(p_day, 1),
      extract(
        day from (
          date_trunc('month', make_date(p_year, p_month, 1))
          + interval '1 month - 1 day'
        )
      )::integer
    )
  )
$$;


--
-- Name: recurring_expense_missing_occurrences(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recurring_expense_missing_occurrences(p_template_id uuid, p_through date DEFAULT CURRENT_DATE) RETURNS TABLE(recurrence_key text, expense_date date, would_be_paid boolean)
    LANGUAGE plpgsql
    AS $$
declare
  t public.recurring_expense_templates%rowtype;
  v_anchor date;
  v_interval integer;
  occ_date date;
  occ_key text;
  m date;
  y integer;
begin
  select * into t from public.recurring_expense_templates where id = p_template_id;
  if not found then return; end if;
  -- Same exclusions as the generator: nothing is owed by a template that is off
  -- or whose amount is only known at pay time.
  if t.is_active = false or t.is_variable_amount then return; end if;

  v_anchor := coalesce(t.start_date, t.created_at::date);

  if t.frequency = 'monthly' then
    v_interval := greatest(1, coalesce(t.interval_months, 1));
    for m in
      select gs::date
      from generate_series(
        date_trunc('month', v_anchor),
        date_trunc('month', p_through::timestamp),
        interval '1 month'
      ) gs
    loop
      -- Keep only months on the interval phase (every N months from the anchor).
      if (((extract(year from m)::int * 12 + extract(month from m)::int)
           - (extract(year from v_anchor)::int * 12 + extract(month from v_anchor)::int)) % v_interval) <> 0 then
        continue;
      end if;

      occ_date := public.recurring_expense_clamped_date(
        extract(year from m)::int, extract(month from m)::int, t.expense_day_of_month
      );
      occ_key := to_char(m, 'YYYY-MM');

      -- Past only — a future charge is still just a forecast.
      if occ_date > p_through then continue; end if;
      if t.start_date is not null and occ_date < t.start_date then continue; end if;
      if t.end_date is not null and occ_date > t.end_date then continue; end if;
      if exists (
        select 1 from public.expenses e
        where e.recurring_expense_template_id = t.id and e.recurrence_key = occ_key
      ) then
        continue;
      end if;

      recurrence_key := occ_key;
      expense_date := occ_date;
      would_be_paid := t.auto_paid;
      return next;
    end loop;

  elsif t.frequency = 'yearly' then
    for y in extract(year from v_anchor)::int .. extract(year from p_through)::int loop
      occ_date := public.recurring_expense_clamped_date(y, t.expense_month_of_year, t.expense_day_of_month);
      occ_key := to_char(occ_date, 'YYYY');

      if occ_date > p_through then continue; end if;
      if t.start_date is not null and occ_date < t.start_date then continue; end if;
      if t.end_date is not null and occ_date > t.end_date then continue; end if;
      if exists (
        select 1 from public.expenses e
        where e.recurring_expense_template_id = t.id and e.recurrence_key = occ_key
      ) then
        continue;
      end if;

      recurrence_key := occ_key;
      expense_date := occ_date;
      would_be_paid := t.auto_paid;
      return next;
    end loop;
  end if;
end;
$$;


--
-- Name: backfill_recurring_expense(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.backfill_recurring_expense(p_template_id uuid, p_through date DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE plpgsql
    AS $$
declare
  t public.recurring_expense_templates%rowtype;
  occ record;
  v_created integer := 0;
begin
  select * into t from public.recurring_expense_templates where id = p_template_id;
  if not found then return 0; end if;

  for occ in
    select * from public.recurring_expense_missing_occurrences(p_template_id, p_through)
  loop
    -- Same insert path as the daily generator, including the auto-paid rule:
    -- a standing order lands already paid on its charge date; a manual bill
    -- lands not_paid and waits for confirmation.
    if public._ensure_recurring_occurrence(t, occ.recurrence_key, occ.expense_date, t.auto_paid) then
      v_created := v_created + 1;
    end if;
  end loop;

  return v_created;
end;
$$;


--
-- Name: calculate_line_total(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_line_total() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.line_total :=
    (coalesce(new.quantity_ordered, 0) * coalesce(new.unit_price, 0))
    - coalesce(new.discount_amount, 0);
  return new;
end;
$$;


--
-- Name: close_task_reminders_on_status_close(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_task_reminders_on_status_close() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.status in ('done', 'cancelled') and old.status is distinct from new.status then
    update public.reminders
    set status = 'done',
        updated_by = (select id from public.users where auth_user_id = auth.uid())
    where task_id = new.id
      and status = 'pending';
  end if;
  return new;
end;
$$;


--
-- Name: create_sales_order(uuid, timestamp with time zone, text, numeric, numeric, numeric, text, uuid, text, jsonb, text, date, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_sales_order(p_customer_id uuid, p_order_date timestamp with time zone, p_status text, p_subtotal numeric, p_discount_amount numeric, p_total_amount numeric, p_payment_status text, p_created_by uuid, p_notes text, p_items jsonb, p_payment_terms text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date, p_needs_invoice boolean DEFAULT NULL::boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_product_id uuid;
  v_description text;
  v_qty numeric;
  v_unit_price numeric;
  v_line_discount numeric;
  v_delivered numeric;
  v_remaining numeric;
  v_normalized_status text;
  v_effective_status text;
  v_total_qty numeric := 0;
  v_total_delivered numeric := 0;
  v_resolved jsonb := '[]'::jsonb;
begin
  if p_customer_id is null then
    raise exception 'customer_id is required';
  end if;
  if p_order_date is null then
    raise exception 'order_date is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array';
  end if;

  v_normalized_status := lower(coalesce(nullif(trim(p_status), ''), 'draft'));

  perform set_config('app.skip_order_total_recalc', 'on', true);

  -- Resolve delivered qty per line, then decide the effective status.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := nullif(trim(coalesce(v_item->>'description', '')), '');
    v_qty := coalesce((v_item->>'quantity_ordered')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    -- A line must be either a catalog product OR a described custom line.
    if (v_product_id is null and v_description is null) or v_qty <= 0 then
      raise exception 'Invalid order item payload';
    end if;

    if v_normalized_status = 'cancelled' then
      v_delivered := 0;
    elsif v_item ? 'quantity_delivered' then
      v_delivered := least(greatest(coalesce((v_item->>'quantity_delivered')::numeric, 0), 0), v_qty);
    else
      v_delivered := case
        when v_normalized_status in ('delivered', 'completed', 'closed') then v_qty
        else 0
      end;
    end if;

    v_total_qty := v_total_qty + v_qty;
    v_total_delivered := v_total_delivered + v_delivered;

    v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'description', v_description,
      'quantity_ordered', v_qty,
      'quantity_delivered', v_delivered,
      'unit_price', v_unit_price,
      'discount_amount', v_line_discount,
      'notes', nullif(trim(coalesce(v_item->>'notes', '')), '')
    ));
  end loop;

  -- Safety: a "delivered/closed" header with an unfinished line is really partial.
  v_effective_status := case
    when v_normalized_status in ('delivered', 'completed', 'closed')
      and v_total_delivered + 0.0000001 < v_total_qty then 'partially_delivered'
    else v_normalized_status
  end;

  insert into public.orders (
    customer_id, order_date, status, subtotal, discount_amount, total_amount,
    payment_status, created_by, notes, payment_terms, due_date, needs_invoice
  ) values (
    p_customer_id, p_order_date, v_effective_status,
    coalesce(p_subtotal, 0), coalesce(p_discount_amount, 0), coalesce(p_total_amount, 0),
    coalesce(nullif(trim(p_payment_status), ''), 'unpaid'), p_created_by,
    nullif(trim(coalesce(p_notes, '')), ''), nullif(trim(coalesce(p_payment_terms, '')), ''),
    p_due_date, p_needs_invoice
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(v_resolved)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := v_item->>'description';
    v_qty := (v_item->>'quantity_ordered')::numeric;
    v_delivered := (v_item->>'quantity_delivered')::numeric;
    v_remaining := v_qty - v_delivered;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_line_discount := (v_item->>'discount_amount')::numeric;

    -- Lock the stock row (backorders allowed — no hard block). Custom lines
    -- have no product to lock.
    if v_product_id is not null then
      perform 1 from public.inventory i where i.product_id = v_product_id for update;
    end if;

    insert into public.order_items (
      order_id, product_id, description, quantity_ordered, quantity_delivered,
      unit_price, discount_amount, notes
    ) values (
      v_order_id, v_product_id, v_description, v_qty, v_delivered,
      v_unit_price, v_line_discount, nullif(v_item->>'notes', '')
    )
    returning id into v_item_id;

    -- Custom (product-less) lines carry no stock — never move inventory.
    if v_product_id is not null and v_normalized_status <> 'cancelled' then
      if v_delivered > 0 then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, 'out', v_delivered, 'order', v_order_id, p_created_by,
          concat('Sales order item ', v_item_id, ' delivered')
        );
      end if;
      if v_remaining > 0 then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, 'reserve', v_remaining, 'order', v_order_id, p_created_by,
          concat('Sales order item ', v_item_id, ' reserved')
        );
      end if;
    end if;
  end loop;

  return v_order_id;
exception
  when others then
    raise;
end;
$$;


--
-- Name: create_sales_order(uuid, timestamp with time zone, text, numeric, numeric, numeric, text, uuid, text, jsonb, text, date, boolean, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_sales_order(p_customer_id uuid, p_order_date timestamp with time zone, p_status text, p_subtotal numeric, p_discount_amount numeric, p_total_amount numeric, p_payment_status text, p_created_by uuid, p_notes text, p_items jsonb, p_payment_terms text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date, p_needs_invoice boolean DEFAULT NULL::boolean, p_requested_delivery_date date DEFAULT NULL::date) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_product_id uuid;
  v_description text;
  v_qty numeric;
  v_unit_price numeric;
  v_line_discount numeric;
  v_delivered numeric;
  v_remaining numeric;
  v_normalized_status text;
  v_effective_status text;
  v_total_qty numeric := 0;
  v_total_delivered numeric := 0;
  v_resolved jsonb := '[]'::jsonb;
begin
  if p_customer_id is null then
    raise exception 'customer_id is required';
  end if;
  if p_order_date is null then
    raise exception 'order_date is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array';
  end if;

  v_normalized_status := lower(coalesce(nullif(trim(p_status), ''), 'draft'));

  perform set_config('app.skip_order_total_recalc', 'on', true);

  -- Resolve delivered qty per line, then decide the effective status.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := nullif(trim(coalesce(v_item->>'description', '')), '');
    v_qty := coalesce((v_item->>'quantity_ordered')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    -- A line must be either a catalog product OR a described custom line.
    if (v_product_id is null and v_description is null) or v_qty <= 0 then
      raise exception 'Invalid order item payload';
    end if;

    if v_normalized_status = 'cancelled' then
      v_delivered := 0;
    elsif v_item ? 'quantity_delivered' then
      v_delivered := least(greatest(coalesce((v_item->>'quantity_delivered')::numeric, 0), 0), v_qty);
    else
      v_delivered := case
        when v_normalized_status in ('delivered', 'completed', 'closed') then v_qty
        else 0
      end;
    end if;

    v_total_qty := v_total_qty + v_qty;
    v_total_delivered := v_total_delivered + v_delivered;

    v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'description', v_description,
      'quantity_ordered', v_qty,
      'quantity_delivered', v_delivered,
      'unit_price', v_unit_price,
      'discount_amount', v_line_discount,
      'notes', nullif(trim(coalesce(v_item->>'notes', '')), '')
    ));
  end loop;

  -- Safety: a "delivered/closed" header with an unfinished line is really partial.
  v_effective_status := case
    when v_normalized_status in ('delivered', 'completed', 'closed')
      and v_total_delivered + 0.0000001 < v_total_qty then 'partially_delivered'
    else v_normalized_status
  end;

  insert into public.orders (
    customer_id, order_date, status, subtotal, discount_amount, total_amount,
    payment_status, created_by, notes, payment_terms, due_date, needs_invoice,
    requested_delivery_date
  ) values (
    p_customer_id, p_order_date, v_effective_status,
    coalesce(p_subtotal, 0), coalesce(p_discount_amount, 0), coalesce(p_total_amount, 0),
    coalesce(nullif(trim(p_payment_status), ''), 'unpaid'), p_created_by,
    nullif(trim(coalesce(p_notes, '')), ''), nullif(trim(coalesce(p_payment_terms, '')), ''),
    p_due_date, p_needs_invoice, p_requested_delivery_date
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(v_resolved)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := v_item->>'description';
    v_qty := (v_item->>'quantity_ordered')::numeric;
    v_delivered := (v_item->>'quantity_delivered')::numeric;
    v_remaining := v_qty - v_delivered;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_line_discount := (v_item->>'discount_amount')::numeric;

    -- Lock the stock row (backorders allowed — no hard block). Custom lines
    -- have no product to lock.
    if v_product_id is not null then
      perform 1 from public.inventory i where i.product_id = v_product_id for update;
    end if;

    insert into public.order_items (
      order_id, product_id, description, quantity_ordered, quantity_delivered,
      unit_price, discount_amount, notes
    ) values (
      v_order_id, v_product_id, v_description, v_qty, v_delivered,
      v_unit_price, v_line_discount, nullif(v_item->>'notes', '')
    )
    returning id into v_item_id;

    -- Custom (product-less) lines carry no stock — never move inventory.
    if v_product_id is not null and v_normalized_status <> 'cancelled' then
      if v_delivered > 0 then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, 'out', v_delivered, 'order', v_order_id, p_created_by,
          concat('Sales order item ', v_item_id, ' delivered')
        );
      end if;
      if v_remaining > 0 then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, 'reserve', v_remaining, 'order', v_order_id, p_created_by,
          concat('Sales order item ', v_item_id, ' reserved')
        );
      end if;
    end if;
  end loop;

  return v_order_id;
exception
  when others then
    raise;
end;
$$;


--
-- Name: create_sales_order(uuid, timestamp with time zone, text, numeric, numeric, numeric, text, uuid, text, jsonb, text, date, boolean, date, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_sales_order(p_customer_id uuid, p_order_date timestamp with time zone, p_status text, p_subtotal numeric, p_discount_amount numeric, p_total_amount numeric, p_payment_status text, p_created_by uuid, p_notes text, p_items jsonb, p_payment_terms text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date, p_needs_invoice boolean DEFAULT NULL::boolean, p_requested_delivery_date date DEFAULT NULL::date, p_branch_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_product_id uuid;
  v_description text;
  v_qty numeric;
  v_unit_price numeric;
  v_line_discount numeric;
  v_delivered numeric;
  v_remaining numeric;
  v_normalized_status text;
  v_effective_status text;
  v_total_qty numeric := 0;
  v_total_delivered numeric := 0;
  v_resolved jsonb := '[]'::jsonb;
begin
  if p_customer_id is null then
    raise exception 'customer_id is required';
  end if;
  if p_order_date is null then
    raise exception 'order_date is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array';
  end if;

  v_normalized_status := lower(coalesce(nullif(trim(p_status), ''), 'draft'));

  perform set_config('app.skip_order_total_recalc', 'on', true);

  -- Resolve delivered qty per line, then decide the effective status.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := nullif(trim(coalesce(v_item->>'description', '')), '');
    v_qty := coalesce((v_item->>'quantity_ordered')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    -- A line must be either a catalog product OR a described custom line.
    if (v_product_id is null and v_description is null) or v_qty <= 0 then
      raise exception 'Invalid order item payload';
    end if;

    if v_normalized_status = 'cancelled' then
      v_delivered := 0;
    elsif v_item ? 'quantity_delivered' then
      v_delivered := least(greatest(coalesce((v_item->>'quantity_delivered')::numeric, 0), 0), v_qty);
    else
      v_delivered := case
        when v_normalized_status in ('delivered', 'completed', 'closed') then v_qty
        else 0
      end;
    end if;

    v_total_qty := v_total_qty + v_qty;
    v_total_delivered := v_total_delivered + v_delivered;

    v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'description', v_description,
      'quantity_ordered', v_qty,
      'quantity_delivered', v_delivered,
      'unit_price', v_unit_price,
      'discount_amount', v_line_discount,
      'notes', nullif(trim(coalesce(v_item->>'notes', '')), '')
    ));
  end loop;

  -- Safety: a "delivered/closed" header with an unfinished line is really partial.
  v_effective_status := case
    when v_normalized_status in ('delivered', 'completed', 'closed')
      and v_total_delivered + 0.0000001 < v_total_qty then 'partially_delivered'
    else v_normalized_status
  end;

  insert into public.orders (
    customer_id, order_date, status, subtotal, discount_amount, total_amount,
    payment_status, created_by, notes, payment_terms, due_date, needs_invoice,
    requested_delivery_date, branch_id
  ) values (
    p_customer_id, p_order_date, v_effective_status,
    coalesce(p_subtotal, 0), coalesce(p_discount_amount, 0), coalesce(p_total_amount, 0),
    coalesce(nullif(trim(p_payment_status), ''), 'unpaid'), p_created_by,
    nullif(trim(coalesce(p_notes, '')), ''), nullif(trim(coalesce(p_payment_terms, '')), ''),
    p_due_date, p_needs_invoice, p_requested_delivery_date, p_branch_id
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(v_resolved)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := v_item->>'description';
    v_qty := (v_item->>'quantity_ordered')::numeric;
    v_delivered := (v_item->>'quantity_delivered')::numeric;
    v_remaining := v_qty - v_delivered;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_line_discount := (v_item->>'discount_amount')::numeric;

    -- Lock the stock row (backorders allowed — no hard block). Custom lines
    -- have no product to lock.
    if v_product_id is not null then
      perform 1 from public.inventory i where i.product_id = v_product_id for update;
    end if;

    insert into public.order_items (
      order_id, product_id, description, quantity_ordered, quantity_delivered,
      unit_price, discount_amount, notes
    ) values (
      v_order_id, v_product_id, v_description, v_qty, v_delivered,
      v_unit_price, v_line_discount, nullif(v_item->>'notes', '')
    )
    returning id into v_item_id;

    -- Custom (product-less) lines carry no stock — never move inventory.
    if v_product_id is not null and v_normalized_status <> 'cancelled' then
      if v_delivered > 0 then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, 'out', v_delivered, 'order', v_order_id, p_created_by,
          concat('Sales order item ', v_item_id, ' delivered')
        );
      end if;
      if v_remaining > 0 then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, 'reserve', v_remaining, 'order', v_order_id, p_created_by,
          concat('Sales order item ', v_item_id, ' reserved')
        );
      end if;
    end if;
  end loop;

  return v_order_id;
exception
  when others then
    raise;
end;
$$;


--
-- Name: current_app_user_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_app_user_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select u.id from public.users u where u.auth_user_id = (select auth.uid()) limit 1;
$$;


--
-- Name: current_user_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_role() RETURNS public.user_role_enum
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select role
  from public.users
  where auth_user_id = (select auth.uid())
    and active = true
    and coalesce(system_access, false) = true;
$$;


--
-- Name: end_my_sessions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.end_my_sessions() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid;
begin
  select id into v_user
  from public.users
  where auth_user_id = auth.uid();
  if v_user is null then return; end if;

  perform set_config('app.skip_audit', 'on', true);
  update public.user_sessions set ended_at = now()
  where user_id = v_user and ended_at is null;
end;
$$;


--
-- Name: generate_recurring_expenses_for_date(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_recurring_expenses_for_date(p_today date DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE plpgsql
    AS $$
declare
  t public.recurring_expense_templates%rowtype;
  v_anchor date;
  v_interval integer;
  occ_date date;
  occ_key text;
  created_count integer := 0;
  m date;
  y integer;
begin
  for t in
    select * from public.recurring_expense_templates
    where is_active = true
    order by created_at asc
  loop
    -- Variable-amount templates are forecast-only (materialized on pay).
    if t.is_variable_amount then
      continue;
    end if;

    v_anchor := coalesce(t.start_date, t.created_at::date);

    if t.frequency = 'monthly' then
      v_interval := greatest(1, coalesce(t.interval_months, 1));
      -- Auto-paid → back-fill every month from the start; manual → current month only.
      for m in
        select gs::date
        from generate_series(
          case when t.auto_paid then date_trunc('month', v_anchor) else date_trunc('month', p_today::timestamp) end,
          date_trunc('month', p_today::timestamp),
          interval '1 month'
        ) gs
      loop
        -- Keep only months on the interval phase (every N months from the anchor).
        if (((extract(year from m)::int * 12 + extract(month from m)::int)
             - (extract(year from v_anchor)::int * 12 + extract(month from v_anchor)::int)) % v_interval) <> 0 then
          continue;
        end if;
        occ_date := public.recurring_expense_clamped_date(
          extract(year from m)::int, extract(month from m)::int, t.expense_day_of_month
        );
        occ_key := to_char(m, 'YYYY-MM');
        if t.auto_paid then
          -- Only up to the charge day that has actually passed.
          if occ_date > p_today then continue; end if;
        else
          -- Manual: created on its create-day (then confirmed later).
          if p_today < public.recurring_expense_clamped_date(
               extract(year from m)::int, extract(month from m)::int, t.create_day_of_month) then
            continue;
          end if;
        end if;
        if public._ensure_recurring_occurrence(t, occ_key, occ_date, t.auto_paid) then
          created_count := created_count + 1;
        end if;
      end loop;

    elsif t.frequency = 'yearly' then
      for y in extract(year from v_anchor)::int .. extract(year from p_today)::int loop
        occ_date := public.recurring_expense_clamped_date(y, t.expense_month_of_year, t.expense_day_of_month);
        occ_key := to_char(occ_date, 'YYYY');
        if t.auto_paid then
          if occ_date > p_today then continue; end if;
        else
          -- Manual yearly: only the current year, on/after its create-day.
          if y <> extract(year from p_today)::int then continue; end if;
          if p_today < public.recurring_expense_clamped_date(y, t.create_month_of_year, t.create_day_of_month) then
            continue;
          end if;
        end if;
        if public._ensure_recurring_occurrence(t, occ_key, occ_date, t.auto_paid) then
          created_count := created_count + 1;
        end if;
      end loop;
    else
      continue;
    end if;
  end loop;

  return created_count;
end;
$$;


--
-- Name: get_alert_read_metrics(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_alert_read_metrics(days integer DEFAULT 30) RETURNS TABLE(category text, delivered integer, read_count integer)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    coalesce(nullif(n.category, ''), 'other')                as category,
    count(*)::int                                            as delivered,
    count(*) filter (where n.read_at is not null)::int       as read_count
  from public.notifications n
  where n.created_at >= now() - make_interval(days => greatest(days, 1))
    and exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.role = 'admin')
  group by 1
  order by delivered desc;
$$;


--
-- Name: get_alert_rule_metrics(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_alert_rule_metrics(days integer DEFAULT 30) RETURNS TABLE(rule_key text, fired integer, still_open integer, resolved integer, snoozed integer, pushed integer, resolved_unpushed integer, avg_resolve_hours numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    coalesce(nullif(split_part(r.dedupe_key, ':', 1), ''), 'manual')                    as rule_key,
    count(*)::int                                                                        as fired,
    count(*) filter (where r.status = 'pending')::int                                    as still_open,
    count(*) filter (where r.status in ('auto_resolved', 'done'))::int                   as resolved,
    count(*) filter (where r.snoozed_until is not null)::int                             as snoozed,
    count(*) filter (where r.notified_at is not null)::int                               as pushed,
    count(*) filter (where r.status in ('auto_resolved', 'done')
                       and r.notified_at is null)::int                                    as resolved_unpushed,
    round(
      avg(extract(epoch from (r.resolved_at - r.created_at)) / 3600.0)
        filter (where r.resolved_at is not null),
      1
    )                                                                                    as avg_resolve_hours
  from public.reminders r
  where r.source = 'system'
    and r.created_at >= now() - make_interval(days => greatest(days, 1))
    and exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.role = 'admin')
  group by 1
  order by fired desc;
$$;


--
-- Name: get_audit_logging(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_audit_logging() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    (select audit_logging_enabled from public.business_settings where id = true),
    true
  );
$$;


--
-- Name: handle_new_auth_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_auth_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.users (id, email, full_name, role, active, system_access, created_at, updated_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'worker_no_access', -- default role (change if you want)
    true,
    true,
    now(),
    now()
  )
  on conflict (id) do nothing;

  return new;
end;
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select public.current_user_role() = 'admin';
$$;


--
-- Name: is_payroll_worker(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_payroll_worker(p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.users u
    where u.id = p_user_id
      and u.active = true
      and u.role in ('worker', 'worker_no_access')
  );
$$;


--
-- Name: log_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_changes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_user uuid;
  v_role text;
BEGIN
  -- Transaction-local opt-out (e.g. the last-seen heartbeat). Empty/missing = audit.
  IF current_setting('app.skip_audit', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_user := auth.uid();
  v_role := public.current_user_role();

  IF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (table_name, record_id, action, old_data, changed_by, user_role)
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD), v_user, v_role);
    RETURN OLD;

  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (table_name, record_id, action, old_data, new_data, changed_by, user_role)
    VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), v_user, v_role);
    RETURN NEW;

  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (table_name, record_id, action, new_data, changed_by, user_role)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW), v_user, v_role);
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;


--
-- Name: order_status_is_open(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.order_status_is_open(p_status text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  select coalesce(p_status, '') not in (
    'delivered', 'completed', 'closed', 'cancelled',
    'סופקה', 'הושלמה', 'סגורה', 'בוטלה'
  );
$$;


--
-- Name: order_is_worker_deliverable(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.order_is_worker_deliverable(p_order_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and (
        public.order_status_is_open(o.status)
        or o.status in ('delivered', 'completed', 'סופקה', 'הושלמה')
      )
  );
$$;


--
-- Name: payslip_items_attach_to_payslip(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payslip_items_attach_to_payslip() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  target_payslip uuid;
begin
  if new.payslip_id is null and new.item_date is not null and new.user_id is not null then
    select p.id
      into target_payslip
    from public.payslips p
    join public.payroll_periods pp on pp.id = p.payroll_period_id
    where p.user_id = new.user_id
      and pp.start_date <= new.item_date
      and pp.end_date >= new.item_date
      -- Mirrors isPayrollPeriodEditable(): only an open month absorbs new items.
      and coalesce(pp.status, 'open') not in ('closed', 'locked', 'approved', 'paid')
    order by pp.start_date desc
    limit 1;

    if target_payslip is not null then
      new.payslip_id := target_payslip;
    end if;
  end if;

  return new;
end;
$$;


--
-- Name: payslip_items_recalc_gross(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payslip_items_recalc_gross() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  ids uuid[];
  pid uuid;
begin
  -- OLD/NEW only exist for the ops that have them — referencing the wrong one
  -- raises "record is not assigned yet", so each branch names only its own.
  if tg_op = 'INSERT' then
    ids := array_remove(array[new.payslip_id], null);
  elsif tg_op = 'DELETE' then
    ids := array_remove(array[old.payslip_id], null);
  else
    ids := array_remove(array[old.payslip_id, new.payslip_id], null);
  end if;

  foreach pid in array ids loop
    update public.payslips p
    set gross_salary = round(
      coalesce(p.calculated_base_salary, 0)
      + coalesce(p.manual_adjustments, 0)
      + coalesce((
          select sum(i.amount)
          from public.payslip_items i
          where i.payslip_id = p.id
        ), 0)
    , 2)
    where p.id = pid;
  end loop;

  return null;
end;
$$;


--
-- Name: product_order_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.product_order_stats() RETURNS TABLE(product_id uuid, order_count bigint, last_used_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    oi.product_id,
    count(*)::bigint               as order_count,
    max(o.order_date)::timestamptz as last_used_at
  from public.order_items oi
  inner join public.orders o on o.id = oi.order_id
  where oi.product_id is not null
  group by oi.product_id
$$;


--
-- Name: protect_payments(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_payments() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Workers cannot update payments
  IF public.current_user_role() = 'worker' THEN
     RAISE EXCEPTION 'Workers cannot modify payments';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: recalculate_order_totals(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalculate_order_totals() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
  v_subtotal numeric;
begin
  -- The create/update_sales_order RPCs compute and set the order totals
  -- authoritatively, then rewrite all order_items. Without this guard the
  -- per-row trigger would fire on every deleted/re-inserted line and log a
  -- stray "עודכן · סכום" audit row at each intermediate subtotal. The RPCs set
  -- this transaction-local flag so the trigger stays silent for their writes;
  -- it still runs for any item change made outside the RPCs.
  if coalesce(current_setting('app.skip_order_total_recalc', true), '') = 'on' then
    return null;
  end if;

  if v_order_id is null then
    return null;
  end if;

  select coalesce(sum(line_total), 0)
  into v_subtotal
  from public.order_items
  where order_id = v_order_id;

  update public.orders o
  set subtotal = v_subtotal,
      total_amount = v_subtotal - coalesce(o.discount_amount, 0),
      updated_at = now()
  where o.id = v_order_id
    and (o.subtotal is distinct from v_subtotal
         or o.total_amount is distinct from v_subtotal - coalesce(o.discount_amount, 0));

  return null;
end;
$$;


--
-- Name: release_order_inventory(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_order_inventory(p_order_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted_count integer;
begin
  if p_order_id is null then
    raise exception 'order_id is required';
  end if;

  delete from public.inventory_movements
  where source_type = 'order'
    and source_id = p_order_id;

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;


--
-- Name: request_attendance_session_edit(uuid, timestamp with time zone, timestamp with time zone, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_attendance_session_edit(p_session_id uuid, p_clock_in timestamp with time zone, p_clock_out timestamp with time zone, p_notes text DEFAULT NULL::text, p_notes_he text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_caller uuid;
  v_caller_role user_role_enum;
  v_session record;
  v_report_id uuid;
begin
  v_caller := public.current_app_user_id();
  if v_caller is null then
    raise exception 'not_authenticated' using hint = 'לא ניתן לזהות את המשתמש.';
  end if;
  v_caller_role := public.current_user_role();

  select s.id, s.user_id, s.clock_in, s.clock_out
    into v_session
  from public.attendance_sessions s
  where s.id = p_session_id;

  if not found then
    raise exception 'session_not_found' using hint = 'המשמרת לא נמצאה.';
  end if;

  -- Yours, or you run the place.
  if v_session.user_id <> v_caller and v_caller_role not in ('admin', 'office') then
    raise exception 'forbidden' using hint = 'אפשר לתקן רק משמרת שלך.';
  end if;

  if p_clock_in is null or p_clock_out is null or p_clock_out <= p_clock_in then
    raise exception 'invalid_range' using hint = 'שעת הסיום חייבת להיות אחרי שעת ההתחלה.';
  end if;
  if p_clock_in > now() + interval '5 minutes' or p_clock_out > now() + interval '5 minutes' then
    raise exception 'future_time' using hint = 'לא ניתן לדווח שעות בעתיד.';
  end if;

  -- Already paid → the money has moved; this is the office's to unpick.
  if exists (
    select 1 from public.worker_payment_allocations a
    where a.attendance_session_id = p_session_id
  ) then
    raise exception 'session_paid' using hint = 'המשמרת כבר שולמה — פנה למנהל.';
  end if;

  -- Inside a closed payroll period → locked, same as everywhere else.
  if exists (
    select 1 from public.payroll_periods p
    where p.status = 'closed'
      and (v_session.clock_in at time zone 'utc')::date between p.start_date and p.end_date
  ) then
    raise exception 'period_locked' using hint = 'תקופת השכר של המשמרת נעולה.';
  end if;

  insert into public.phone_attendance_reports (
    user_id, clock_in, clock_out, worked_minutes, status, source,
    reported_by, replaces_session_id, notes, notes_he
  )
  values (
    v_session.user_id,
    p_clock_in,
    p_clock_out,
    greatest(0, (extract(epoch from (p_clock_out - p_clock_in)) / 60)::integer),
    'pending_review',
    'app',
    v_caller,
    p_session_id,
    nullif(btrim(coalesce(p_notes, '')), ''),
    nullif(btrim(coalesce(p_notes_he, '')), '')
  )
  returning id into v_report_id;

  -- Only now does it leave payroll. If the insert above had failed, the whole
  -- statement rolls back and the session is still there.
  delete from public.attendance_sessions where id = p_session_id;

  return v_report_id;
end;
$$;


--
-- Name: session_heartbeat(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.session_heartbeat(p_session_id uuid, p_user_agent text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user uuid;
begin
  select id into v_user
  from public.users
  where auth_user_id = auth.uid();
  if v_user is null then return; end if;

  perform set_config('app.skip_audit', 'on', true); -- transaction-local

  insert into public.user_sessions (id, user_id, started_at, last_seen_at, user_agent, ended_at)
  values (p_session_id, v_user, now(), now(), p_user_agent, null)
  on conflict (id) do update set last_seen_at = now(), ended_at = null;

  update public.users set last_seen_at = now() where id = v_user;
end;
$$;


--
-- Name: set_audit_logging(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_audit_logging(p_enabled boolean) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  r record;
begin
  -- Only admins may toggle.
  if not exists (
    select 1 from public.users
    where auth_user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'forbidden';
  end if;

  -- Enable/disable each trigger backed by public.log_changes, by exact name,
  -- so we never touch unrelated business triggers on the same table.
  for r in
    select c.relname as table_name, tg.tgname as trigger_name
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and tg.tgfoid = 'public.log_changes'::regproc
      and not tg.tgisinternal
  loop
    execute format(
      'alter table public.%I %s trigger %I',
      r.table_name,
      case when p_enabled then 'enable' else 'disable' end,
      r.trigger_name
    );
  end loop;

  update public.business_settings
    set audit_logging_enabled = p_enabled
    where id = true;

  return p_enabled;
end;
$$;


--
-- Name: set_my_avatar_color(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_avatar_color(p_color text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_color text := nullif(btrim(coalesce(p_color, '')), '');
begin
  if v_color is not null and v_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'invalid avatar_color: %', p_color;
  end if;
  update public.users
  set avatar_color = v_color
  where auth_user_id = auth.uid();
  return v_color;
end;
$_$;


--
-- Name: set_my_dashboard_prefs(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_dashboard_prefs(p_prefs jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_prefs jsonb := p_prefs;
begin
  -- Defensive: only accept a json object (or null to reset). Anything else → reset.
  if v_prefs is not null and jsonb_typeof(v_prefs) <> 'object' then
    v_prefs := null;
  end if;

  update public.users
  set dashboard_prefs = v_prefs
  where auth_user_id = auth.uid();

  return v_prefs;
end;
$$;


--
-- Name: set_my_digest_seen_at(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_digest_seen_at(p_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_at timestamptz := coalesce(p_at, now());
begin
  update public.users
  set digest_seen_at = v_at
  where auth_user_id = auth.uid();

  return v_at;
end;
$$;


--
-- Name: set_my_font_scale(real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_font_scale(p_scale real) RETURNS real
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_scale real := least(greatest(coalesce(p_scale, 1), 0.5), 2);
begin
  update public.users
  set font_scale = v_scale
  where auth_user_id = auth.uid();
  return v_scale;
end;
$$;


--
-- Name: set_my_font_scale_mobile(real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_font_scale_mobile(p_scale real) RETURNS real
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_scale real := least(greatest(coalesce(p_scale, 1), 0.5), 2);
begin
  update public.users
  set font_scale_mobile = v_scale
  where auth_user_id = auth.uid();

  return v_scale;
end;
$$;


--
-- Name: set_my_inbox_seen_at(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_inbox_seen_at(p_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_at timestamptz := coalesce(p_at, now());
begin
  update public.users
  set inbox_seen_at = v_at
  where auth_user_id = auth.uid();

  return v_at;
end;
$$;


--
-- Name: set_my_locale(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_locale(p_locale text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_locale text := case when p_locale in ('he', 'ar') then p_locale else 'he' end;
begin
  update public.users
  set locale = v_locale
  where auth_user_id = auth.uid();
  return v_locale;
end;
$$;


--
-- Name: set_my_notification_prefs(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_notification_prefs(p_prefs jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_prefs jsonb := p_prefs;
begin
  if v_prefs is not null and jsonb_typeof(v_prefs) <> 'object' then
    v_prefs := null;
  end if;

  update public.users
  set notification_prefs = v_prefs
  where auth_user_id = auth.uid();

  return v_prefs;
end;
$$;


--
-- Name: set_my_profile_details(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_profile_details(p_full_name text, p_phone text) RETURNS TABLE(full_name text, phone text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  -- A blank display name would make the user vanish from every list/avatar.
  if v_name is null then
    raise exception 'full_name is required';
  end if;

  update public.users u
  set full_name = v_name,
      phone = v_phone
  where u.auth_user_id = auth.uid();

  return query
  select v_name, v_phone;
end;
$$;


--
-- Name: set_my_worklist_prefs(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_my_worklist_prefs(p_prefs jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_prefs jsonb := p_prefs;
begin
  if v_prefs is not null and jsonb_typeof(v_prefs) <> 'object' then
    v_prefs := null;
  end if;

  update public.users
  set worklist_prefs = v_prefs
  where auth_user_id = auth.uid();

  return v_prefs;
end;
$$;


--
-- Name: set_reminders_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_reminders_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: set_task_comments_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_task_comments_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: set_task_sort_order(uuid, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_task_sort_order(p_task_id uuid, p_sort_order double precision) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  perform set_config('app.skip_audit', 'on', true);
  update public.tasks set sort_order = p_sort_order where id = p_task_id;
end;
$$;


--
-- Name: sync_inventory_from_movements(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_inventory_from_movements() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op = 'INSERT' then
    perform public.apply_inventory_movement_effect(
      new.product_id,
      new.movement_type,
      new.quantity,
      1
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Revert old effect (no guard — this leg can transiently go negative), then
    -- apply the new effect (guarded — validates the final on-hand).
    perform public.apply_inventory_movement_effect(
      old.product_id,
      old.movement_type,
      old.quantity,
      -1,
      false
    );
    perform public.apply_inventory_movement_effect(
      new.product_id,
      new.movement_type,
      new.quantity,
      1,
      true
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Revert deleted movement.
    perform public.apply_inventory_movement_effect(
      old.product_id,
      old.movement_type,
      old.quantity,
      -1
    );
    return old;
  end if;

  return null;
end;
$$;


--
-- Name: sync_vehicle_mileage_cache(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_vehicle_mileage_cache() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_tag_id uuid := coalesce(new.tag_id, old.tag_id);
  v_reading integer;
  v_date date;
begin
  select reading, recorded_at into v_reading, v_date
  from public.vehicle_mileage_readings
  where tag_id = v_tag_id
  order by recorded_at desc, created_at desc
  limit 1;

  update public.vehicles
  set mileage = v_reading, mileage_updated_at = v_date
  where tag_id = v_tag_id;

  return coalesce(new, old);
end;
$$;


--
-- Name: tag_rollup(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tag_rollup() RETURNS TABLE(tag_id uuid, total_expense_amount numeric, paid_expense_amount numeric, total_income_amount numeric, task_count bigint, open_task_count bigint, document_count bigint)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    t.id as tag_id,
    coalesce(ex.total_amount, 0),
    coalesce(ex.paid_amount, 0),
    coalesce(pm.income_amount, 0),
    coalesce(tk.task_count, 0),
    coalesce(tk.open_task_count, 0),
    coalesce(dc.document_count, 0)
  from public.tags t
  left join (
    select et.tag_id,
           sum(e.amount) as total_amount,
           sum(case when e.payment_status = 'paid' then e.amount
                    else coalesce(e.paid_amount, 0) end) as paid_amount
    from public.entity_tags et
    join public.expenses e on e.id = et.entity_id
    where et.entity_type = 'expense'
    group by et.tag_id
  ) ex on ex.tag_id = t.id
  left join (
    select et.tag_id, sum(p.amount_total) as income_amount
    from public.entity_tags et
    join public.payments p on p.id = et.entity_id
    where et.entity_type = 'payment'
    group by et.tag_id
  ) pm on pm.tag_id = t.id
  left join (
    select et.tag_id,
           count(*) as task_count,
           count(*) filter (
             where coalesce(ts.status,'todo') not in ('done','cancelled')
           ) as open_task_count
    from public.entity_tags et
    join public.tasks ts on ts.id = et.entity_id
    where et.entity_type = 'task'
    group by et.tag_id
  ) tk on tk.tag_id = t.id
  left join (
    select et.tag_id, count(*) as document_count
    from public.entity_tags et
    where et.entity_type = 'document'
    group by et.tag_id
  ) dc on dc.tag_id = t.id;
$$;


--
-- Name: task_current_user_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.task_current_user_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select id from public.users where auth_user_id = (select auth.uid()) limit 1;
$$;


--
-- Name: task_is_office_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.task_is_office_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.role in ('admin', 'office')
      and u.active = true
      and coalesce(u.system_access, false) = true
  );
$$;


--
-- Name: task_can_access(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.task_can_access(p_task_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and case
        when coalesce(t.is_private, false)
          then t.private_owner_id = public.task_current_user_id()
        else
          public.task_is_office_admin()
          or t.assigned_user_id = public.task_current_user_id()
          or exists (
            select 1 from public.task_members m
            where m.task_id = t.id and m.user_id = public.task_current_user_id()
          )
      end
  );
$$;


--
-- Name: task_can_manage(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.task_can_manage(p_task_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and case
        when coalesce(t.is_private, false)
          then t.private_owner_id = public.task_current_user_id()
        else
          public.task_is_office_admin()
          or t.assigned_user_id = public.task_current_user_id()
      end
  );
$$;


--
-- Name: touch_last_seen(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_last_seen() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM set_config('app.skip_audit', 'on', true); -- true = transaction-local
  UPDATE public.users SET last_seen_at = now() WHERE auth_user_id = auth.uid();
END;
$$;


--
-- Name: update_sales_order(uuid, uuid, timestamp with time zone, text, numeric, numeric, numeric, text, uuid, text, jsonb, text, date, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_sales_order(p_order_id uuid, p_customer_id uuid, p_order_date timestamp with time zone, p_status text, p_subtotal numeric, p_discount_amount numeric, p_total_amount numeric, p_payment_status text, p_updated_by uuid, p_notes text, p_items jsonb, p_payment_terms text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date, p_delivery_date timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_item jsonb;
  v_item_id uuid;
  v_product_id uuid;
  v_description text;
  v_qty numeric;
  v_unit_price numeric;
  v_line_discount numeric;
  v_delivered numeric;
  v_remaining numeric;
  v_prior numeric;
  v_target_status text;
  v_effective_status text;
  v_prior_delivered jsonb;
  v_total_qty numeric := 0;
  v_total_delivered numeric := 0;
  v_resolved jsonb := '[]'::jsonb;
begin
  if p_order_id is null then
    raise exception 'order_id is required';
  end if;
  if p_customer_id is null then
    raise exception 'customer_id is required';
  end if;
  if p_order_date is null then
    raise exception 'order_date is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array';
  end if;

  select coalesce(nullif(lower(trim(p_status)), ''), lower(coalesce(o.status, 'draft')))
  into v_target_status
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;

  perform set_config('app.skip_order_total_recalc', 'on', true);

  -- Snapshot delivered-so-far per product BEFORE we delete the lines, so a normal
  -- edit (which sends no quantity_delivered) doesn't wipe delivery progress.
  -- Catalog lines only — a custom line has no product_id to key this by.
  select coalesce(jsonb_object_agg(product_id::text, delivered), '{}'::jsonb)
  into v_prior_delivered
  from (
    select product_id, sum(quantity_delivered) as delivered
    from public.order_items
    where order_id = p_order_id and product_id is not null
    group by product_id
  ) s;

  -- Resolve delivered qty per line, decide effective status.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := nullif(trim(coalesce(v_item->>'description', '')), '');
    v_qty := coalesce((v_item->>'quantity_ordered')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    -- A line must be either a catalog product OR a described custom line.
    if (v_product_id is null and v_description is null)
       or v_qty <= 0 or v_unit_price < 0 or v_line_discount < 0 then
      raise exception 'Invalid order item payload';
    end if;

    if v_target_status = 'cancelled' then
      v_delivered := 0;
    elsif v_item ? 'quantity_delivered' then
      -- Authoritative (the אישור אספקה flow sends cumulative delivered per line).
      v_delivered := least(greatest(coalesce((v_item->>'quantity_delivered')::numeric, 0), 0), v_qty);
    elsif v_product_id is not null then
      -- Restore from the pre-edit snapshot (drained across duplicate product lines).
      v_prior := coalesce((v_prior_delivered->>v_product_id::text)::numeric, 0);
      v_delivered := least(v_prior, v_qty);
      v_prior_delivered := jsonb_set(
        v_prior_delivered, array[v_product_id::text], to_jsonb(greatest(v_prior - v_delivered, 0))
      );
    else
      -- Custom line, no quantity_delivered sent and nothing to restore — fall
      -- back to the status-derived default, same as a catalog line with no history.
      v_delivered := case
        when v_target_status in ('delivered', 'completed', 'closed') then v_qty
        else 0
      end;
    end if;

    v_total_qty := v_total_qty + v_qty;
    v_total_delivered := v_total_delivered + v_delivered;

    v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'description', v_description,
      'quantity_ordered', v_qty,
      'quantity_delivered', v_delivered,
      'unit_price', v_unit_price,
      'discount_amount', v_line_discount,
      'notes', nullif(trim(coalesce(v_item->>'notes', '')), '')
    ));
  end loop;

  v_effective_status := case
    when v_target_status in ('delivered', 'completed', 'closed')
      and v_total_delivered + 0.0000001 < v_total_qty then 'partially_delivered'
    else v_target_status
  end;

  delete from public.inventory_movements
  where source_type = 'order' and source_id = p_order_id;

  delete from public.order_items where order_id = p_order_id;

  update public.orders
  set customer_id = p_customer_id,
      order_date = p_order_date,
      status = coalesce(nullif(trim(v_effective_status), ''), 'draft'),
      subtotal = coalesce(p_subtotal, 0),
      discount_amount = coalesce(p_discount_amount, 0),
      total_amount = coalesce(p_total_amount, 0),
      payment_status = coalesce(nullif(trim(p_payment_status), ''), 'unpaid'),
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      payment_terms = nullif(trim(coalesce(p_payment_terms, '')), ''),
      due_date = p_due_date,
      -- only the "אישור אספקה" flow sends a delivery date; never wipe an existing one
      delivery_confirmed_at = coalesce(p_delivery_date, delivery_confirmed_at)
  where id = p_order_id;

  for v_item in select value from jsonb_array_elements(v_resolved)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := v_item->>'description';
    v_qty := (v_item->>'quantity_ordered')::numeric;
    v_delivered := (v_item->>'quantity_delivered')::numeric;
    v_remaining := v_qty - v_delivered;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_line_discount := (v_item->>'discount_amount')::numeric;

    if v_product_id is not null then
      perform 1 from public.inventory i where i.product_id = v_product_id for update;
    end if;

    insert into public.order_items (
      order_id, product_id, description, quantity_ordered, quantity_delivered,
      unit_price, discount_amount, notes
    ) values (
      p_order_id, v_product_id, v_description, v_qty, v_delivered,
      v_unit_price, v_line_discount, nullif(v_item->>'notes', '')
    )
    returning id into v_item_id;

    if v_product_id is not null and v_target_status <> 'cancelled' then
      if v_delivered > 0 then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, 'out', v_delivered, 'order', p_order_id, p_updated_by,
          concat('Sales order item ', v_item_id, ' delivered')
        );
      end if;
      if v_remaining > 0 then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, 'reserve', v_remaining, 'order', p_order_id, p_updated_by,
          concat('Sales order item ', v_item_id, ' reserved')
        );
      end if;
    end if;
  end loop;

  return p_order_id;
exception
  when others then
    raise;
end;
$$;


--
-- Name: update_sales_order(uuid, uuid, timestamp with time zone, text, numeric, numeric, numeric, text, uuid, text, jsonb, text, date, timestamp with time zone, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_sales_order(p_order_id uuid, p_customer_id uuid, p_order_date timestamp with time zone, p_status text, p_subtotal numeric, p_discount_amount numeric, p_total_amount numeric, p_payment_status text, p_updated_by uuid, p_notes text, p_items jsonb, p_payment_terms text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date, p_delivery_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_requested_delivery_date date DEFAULT NULL::date) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_item jsonb;
  v_item_id uuid;
  v_product_id uuid;
  v_description text;
  v_qty numeric;
  v_unit_price numeric;
  v_line_discount numeric;
  v_delivered numeric;
  v_remaining numeric;
  v_prior numeric;
  v_target_status text;
  v_effective_status text;
  v_prior_delivered jsonb;
  v_total_qty numeric := 0;
  v_total_delivered numeric := 0;
  v_resolved jsonb := '[]'::jsonb;
begin
  if p_order_id is null then
    raise exception 'order_id is required';
  end if;
  if p_customer_id is null then
    raise exception 'customer_id is required';
  end if;
  if p_order_date is null then
    raise exception 'order_date is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array';
  end if;

  select coalesce(nullif(lower(trim(p_status)), ''), lower(coalesce(o.status, 'draft')))
  into v_target_status
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;

  perform set_config('app.skip_order_total_recalc', 'on', true);

  -- Snapshot delivered-so-far per product BEFORE we delete the lines, so a normal
  -- edit (which sends no quantity_delivered) doesn't wipe delivery progress.
  -- Catalog lines only — a custom line has no product_id to key this by.
  select coalesce(jsonb_object_agg(product_id::text, delivered), '{}'::jsonb)
  into v_prior_delivered
  from (
    select product_id, sum(quantity_delivered) as delivered
    from public.order_items
    where order_id = p_order_id and product_id is not null
    group by product_id
  ) s;

  -- Resolve delivered qty per line, decide effective status.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := nullif(trim(coalesce(v_item->>'description', '')), '');
    v_qty := coalesce((v_item->>'quantity_ordered')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    -- A line must be either a catalog product OR a described custom line.
    if (v_product_id is null and v_description is null)
       or v_qty <= 0 or v_unit_price < 0 or v_line_discount < 0 then
      raise exception 'Invalid order item payload';
    end if;

    if v_target_status = 'cancelled' then
      v_delivered := 0;
    elsif v_item ? 'quantity_delivered' then
      -- Authoritative (the אישור אספקה flow sends cumulative delivered per line).
      v_delivered := least(greatest(coalesce((v_item->>'quantity_delivered')::numeric, 0), 0), v_qty);
    elsif v_product_id is not null then
      -- Restore from the pre-edit snapshot (drained across duplicate product lines).
      v_prior := coalesce((v_prior_delivered->>v_product_id::text)::numeric, 0);
      v_delivered := least(v_prior, v_qty);
      v_prior_delivered := jsonb_set(
        v_prior_delivered, array[v_product_id::text], to_jsonb(greatest(v_prior - v_delivered, 0))
      );
    else
      -- Custom line, no quantity_delivered sent and nothing to restore — fall
      -- back to the status-derived default, same as a catalog line with no history.
      v_delivered := case
        when v_target_status in ('delivered', 'completed', 'closed') then v_qty
        else 0
      end;
    end if;

    v_total_qty := v_total_qty + v_qty;
    v_total_delivered := v_total_delivered + v_delivered;

    v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'description', v_description,
      'quantity_ordered', v_qty,
      'quantity_delivered', v_delivered,
      'unit_price', v_unit_price,
      'discount_amount', v_line_discount,
      'notes', nullif(trim(coalesce(v_item->>'notes', '')), '')
    ));
  end loop;

  v_effective_status := case
    when v_target_status in ('delivered', 'completed', 'closed')
      and v_total_delivered + 0.0000001 < v_total_qty then 'partially_delivered'
    else v_target_status
  end;

  delete from public.inventory_movements
  where source_type = 'order' and source_id = p_order_id;

  delete from public.order_items where order_id = p_order_id;

  update public.orders
  set customer_id = p_customer_id,
      order_date = p_order_date,
      status = coalesce(nullif(trim(v_effective_status), ''), 'draft'),
      subtotal = coalesce(p_subtotal, 0),
      discount_amount = coalesce(p_discount_amount, 0),
      total_amount = coalesce(p_total_amount, 0),
      payment_status = coalesce(nullif(trim(p_payment_status), ''), 'unpaid'),
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      payment_terms = nullif(trim(coalesce(p_payment_terms, '')), ''),
      due_date = p_due_date,
      -- only the "אישור אספקה" flow sends a delivery date; never wipe an existing one
      delivery_confirmed_at = coalesce(p_delivery_date, delivery_confirmed_at),
      -- freely editable any time the wizard is saved, unlike delivery_confirmed_at
      requested_delivery_date = p_requested_delivery_date
  where id = p_order_id;

  for v_item in select value from jsonb_array_elements(v_resolved)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := v_item->>'description';
    v_qty := (v_item->>'quantity_ordered')::numeric;
    v_delivered := (v_item->>'quantity_delivered')::numeric;
    v_remaining := v_qty - v_delivered;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_line_discount := (v_item->>'discount_amount')::numeric;

    if v_product_id is not null then
      perform 1 from public.inventory i where i.product_id = v_product_id for update;
    end if;

    insert into public.order_items (
      order_id, product_id, description, quantity_ordered, quantity_delivered,
      unit_price, discount_amount, notes
    ) values (
      p_order_id, v_product_id, v_description, v_qty, v_delivered,
      v_unit_price, v_line_discount, nullif(v_item->>'notes', '')
    )
    returning id into v_item_id;

    if v_product_id is not null and v_target_status <> 'cancelled' then
      if v_delivered > 0 then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, 'out', v_delivered, 'order', p_order_id, p_updated_by,
          concat('Sales order item ', v_item_id, ' delivered')
        );
      end if;
      if v_remaining > 0 then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, 'reserve', v_remaining, 'order', p_order_id, p_updated_by,
          concat('Sales order item ', v_item_id, ' reserved')
        );
      end if;
    end if;
  end loop;

  return p_order_id;
exception
  when others then
    raise;
end;
$$;


--
-- Name: update_sales_order(uuid, uuid, timestamp with time zone, text, numeric, numeric, numeric, text, uuid, text, jsonb, text, date, timestamp with time zone, date, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_sales_order(p_order_id uuid, p_customer_id uuid, p_order_date timestamp with time zone, p_status text, p_subtotal numeric, p_discount_amount numeric, p_total_amount numeric, p_payment_status text, p_updated_by uuid, p_notes text, p_items jsonb, p_payment_terms text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date, p_delivery_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_requested_delivery_date date DEFAULT NULL::date, p_branch_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_item jsonb;
  v_item_id uuid;
  v_product_id uuid;
  v_description text;
  v_qty numeric;
  v_unit_price numeric;
  v_line_discount numeric;
  v_delivered numeric;
  v_remaining numeric;
  v_prior numeric;
  v_target_status text;
  v_effective_status text;
  v_prior_delivered jsonb;
  v_total_qty numeric := 0;
  v_total_delivered numeric := 0;
  v_resolved jsonb := '[]'::jsonb;
begin
  if p_order_id is null then
    raise exception 'order_id is required';
  end if;
  if p_customer_id is null then
    raise exception 'customer_id is required';
  end if;
  if p_order_date is null then
    raise exception 'order_date is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array';
  end if;

  select coalesce(nullif(lower(trim(p_status)), ''), lower(coalesce(o.status, 'draft')))
  into v_target_status
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;

  perform set_config('app.skip_order_total_recalc', 'on', true);

  -- Snapshot delivered-so-far per product BEFORE we delete the lines, so a normal
  -- edit (which sends no quantity_delivered) doesn't wipe delivery progress.
  -- Catalog lines only — a custom line has no product_id to key this by.
  select coalesce(jsonb_object_agg(product_id::text, delivered), '{}'::jsonb)
  into v_prior_delivered
  from (
    select product_id, sum(quantity_delivered) as delivered
    from public.order_items
    where order_id = p_order_id and product_id is not null
    group by product_id
  ) s;

  -- Resolve delivered qty per line, decide effective status.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := nullif(trim(coalesce(v_item->>'description', '')), '');
    v_qty := coalesce((v_item->>'quantity_ordered')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_line_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    -- A line must be either a catalog product OR a described custom line.
    if (v_product_id is null and v_description is null)
       or v_qty <= 0 or v_unit_price < 0 or v_line_discount < 0 then
      raise exception 'Invalid order item payload';
    end if;

    if v_target_status = 'cancelled' then
      v_delivered := 0;
    elsif v_item ? 'quantity_delivered' then
      -- Authoritative (the אישור אספקה flow sends cumulative delivered per line).
      v_delivered := least(greatest(coalesce((v_item->>'quantity_delivered')::numeric, 0), 0), v_qty);
    elsif v_product_id is not null then
      -- Restore from the pre-edit snapshot (drained across duplicate product lines).
      v_prior := coalesce((v_prior_delivered->>v_product_id::text)::numeric, 0);
      v_delivered := least(v_prior, v_qty);
      v_prior_delivered := jsonb_set(
        v_prior_delivered, array[v_product_id::text], to_jsonb(greatest(v_prior - v_delivered, 0))
      );
    else
      -- Custom line, no quantity_delivered sent and nothing to restore — fall
      -- back to the status-derived default, same as a catalog line with no history.
      v_delivered := case
        when v_target_status in ('delivered', 'completed', 'closed') then v_qty
        else 0
      end;
    end if;

    v_total_qty := v_total_qty + v_qty;
    v_total_delivered := v_total_delivered + v_delivered;

    v_resolved := v_resolved || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'description', v_description,
      'quantity_ordered', v_qty,
      'quantity_delivered', v_delivered,
      'unit_price', v_unit_price,
      'discount_amount', v_line_discount,
      'notes', nullif(trim(coalesce(v_item->>'notes', '')), '')
    ));
  end loop;

  v_effective_status := case
    when v_target_status in ('delivered', 'completed', 'closed')
      and v_total_delivered + 0.0000001 < v_total_qty then 'partially_delivered'
    else v_target_status
  end;

  delete from public.inventory_movements
  where source_type = 'order' and source_id = p_order_id;

  delete from public.order_items where order_id = p_order_id;

  update public.orders
  set customer_id = p_customer_id,
      order_date = p_order_date,
      status = coalesce(nullif(trim(v_effective_status), ''), 'draft'),
      subtotal = coalesce(p_subtotal, 0),
      discount_amount = coalesce(p_discount_amount, 0),
      total_amount = coalesce(p_total_amount, 0),
      payment_status = coalesce(nullif(trim(p_payment_status), ''), 'unpaid'),
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      payment_terms = nullif(trim(coalesce(p_payment_terms, '')), ''),
      due_date = p_due_date,
      -- only the "אישור אספקה" flow sends a delivery date; never wipe an existing one
      delivery_confirmed_at = coalesce(p_delivery_date, delivery_confirmed_at),
      -- freely editable any time the wizard is saved, unlike delivery_confirmed_at
      requested_delivery_date = p_requested_delivery_date,
      branch_id = p_branch_id
  where id = p_order_id;

  for v_item in select value from jsonb_array_elements(v_resolved)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_description := v_item->>'description';
    v_qty := (v_item->>'quantity_ordered')::numeric;
    v_delivered := (v_item->>'quantity_delivered')::numeric;
    v_remaining := v_qty - v_delivered;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_line_discount := (v_item->>'discount_amount')::numeric;

    if v_product_id is not null then
      perform 1 from public.inventory i where i.product_id = v_product_id for update;
    end if;

    insert into public.order_items (
      order_id, product_id, description, quantity_ordered, quantity_delivered,
      unit_price, discount_amount, notes
    ) values (
      p_order_id, v_product_id, v_description, v_qty, v_delivered,
      v_unit_price, v_line_discount, nullif(v_item->>'notes', '')
    )
    returning id into v_item_id;

    if v_product_id is not null and v_target_status <> 'cancelled' then
      if v_delivered > 0 then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, 'out', v_delivered, 'order', p_order_id, p_updated_by,
          concat('Sales order item ', v_item_id, ' delivered')
        );
      end if;
      if v_remaining > 0 then
        insert into public.inventory_movements (
          product_id, movement_type, quantity, source_type, source_id, performed_by, notes
        ) values (
          v_product_id, 'reserve', v_remaining, 'order', p_order_id, p_updated_by,
          concat('Sales order item ', v_item_id, ' reserved')
        );
      end if;
    end if;
  end loop;

  return p_order_id;
exception
  when others then
    raise;
end;
$$;


--
-- Name: users_fill_auth_user_id_from_existing_auth(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.users_fill_auth_user_id_from_existing_auth() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.auth_user_id is null
     and exists (
       select 1
       from auth.users
       where id = new.id
     ) then
    new.auth_user_id := new.id;
  end if;

  return new;
end;
$$;


--
-- Name: worker_ledger_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.worker_ledger_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===== views =====
--
-- Name: cash_flow_entries_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.cash_flow_entries_view WITH (security_invoker = on) AS
 WITH payment_entries AS (
         SELECT concat('payment:', p.id) AS id,
            (p.payment_date)::date AS entry_date,
            'income'::text AS type,
            COALESCE(p.amount_total, (0)::numeric) AS amount,
            COALESCE(p.amount_total, (0)::numeric) AS signed_amount,
            p.project_id,
            pr.name AS project_name,
            COALESCE(NULLIF(TRIM(BOTH FROM p.notes), ''::text), NULLIF(TRIM(BOTH FROM p.reference_number), ''::text), NULLIF(TRIM(BOTH FROM p.payment_method), ''::text), 'תשלום'::text) AS description,
            COALESCE(NULLIF(TRIM(BOTH FROM p.reference_number), ''::text), (p.id)::text) AS reference,
            'payment'::text AS source_type,
            p.id AS source_id,
            o.customer_id
           FROM ((public.payments p
             LEFT JOIN public.projects pr ON ((pr.id = p.project_id)))
             LEFT JOIN public.orders o ON ((o.id = p.order_id)))
          WHERE (p.payment_date IS NOT NULL)
        ), expense_entries AS (
         SELECT concat('expense:', e.id) AS id,
            (e.expense_date)::date AS entry_date,
            'expense'::text AS type,
            COALESCE(e.amount, (0)::numeric) AS amount,
            (- abs(COALESCE(e.amount, (0)::numeric))) AS signed_amount,
            e.project_id,
            pr.name AS project_name,
            COALESCE(NULLIF(TRIM(BOTH FROM e.description), ''::text), NULLIF(TRIM(BOTH FROM e.notes), ''::text), NULLIF(TRIM(BOTH FROM e.category), ''::text), 'הוצאה'::text) AS description,
            COALESCE(NULLIF(TRIM(BOTH FROM e.category), ''::text), (e.id)::text) AS reference,
            'expense'::text AS source_type,
            e.id AS source_id,
            NULL::uuid AS customer_id
           FROM (public.expenses e
             LEFT JOIN public.projects pr ON ((pr.id = e.project_id)))
          WHERE (e.expense_date IS NOT NULL)
        )
 SELECT payment_entries.id,
    payment_entries.entry_date,
    payment_entries.type,
    payment_entries.amount,
    payment_entries.signed_amount,
    payment_entries.project_id,
    payment_entries.project_name,
    payment_entries.description,
    payment_entries.reference,
    payment_entries.source_type,
    payment_entries.source_id,
    payment_entries.customer_id
   FROM payment_entries
UNION ALL
 SELECT expense_entries.id,
    expense_entries.entry_date,
    expense_entries.type,
    expense_entries.amount,
    expense_entries.signed_amount,
    expense_entries.project_id,
    expense_entries.project_name,
    expense_entries.description,
    expense_entries.reference,
    expense_entries.source_type,
    expense_entries.source_id,
    expense_entries.customer_id
   FROM expense_entries;


--
-- Name: cash_flow_monthly_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.cash_flow_monthly_view WITH (security_invoker = on) AS
 SELECT (date_trunc('month'::text, d))::date AS month,
    sum(income) AS total_income,
    sum(expense) AS total_expenses,
    (sum(income) - sum(expense)) AS net_cash_flow
   FROM ( SELECT payments.payment_date AS d,
            payments.amount_total AS income,
            0 AS expense
           FROM public.payments
        UNION ALL
         SELECT expenses.expense_date AS d,
            0 AS income,
            expenses.amount AS expense
           FROM public.expenses) x
  GROUP BY (date_trunc('month'::text, d))
  ORDER BY ((date_trunc('month'::text, d))::date);


--
-- Name: cash_flow_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.cash_flow_view WITH (security_invoker = on) AS
 SELECT month,
    total_income,
    total_expenses,
    net_cash_flow
   FROM public.cash_flow_monthly_view;


--
-- Name: order_financials_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.order_financials_view WITH (security_invoker = on) AS
 WITH payment_totals AS (
         SELECT p.order_id,
            count(*) AS payment_count,
            COALESCE(sum(
                CASE
                    WHEN (COALESCE(p.payment_status, 'cleared'::public.payment_status_enum) <> ALL (ARRAY['pending'::public.payment_status_enum, 'rejected'::public.payment_status_enum])) THEN COALESCE(p.amount_total, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS collected_amount,
            COALESCE(sum(
                CASE
                    WHEN (p.payment_status = 'pending'::public.payment_status_enum) THEN COALESCE(p.amount_total, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS pending_amount,
            COALESCE(sum(
                CASE
                    WHEN ((p.payment_status = 'pending'::public.payment_status_enum) AND (p.due_date IS NOT NULL) AND (p.due_date <= CURRENT_DATE)) THEN COALESCE(p.amount_total, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS overdue_pending_amount,
            min(
                CASE
                    WHEN (p.payment_status = 'pending'::public.payment_status_enum) THEN p.due_date
                    ELSE NULL::date
                END) AS next_due_date,
            (max(p.payment_date))::date AS last_payment_date
           FROM public.payments p
          WHERE (p.order_id IS NOT NULL)
          GROUP BY p.order_id
        )
 SELECT o.id AS order_id,
    o.id,
    o.customer_id,
    COALESCE(o.total_amount, (0)::numeric) AS order_total,
    COALESCE(o.total_amount, (0)::numeric) AS total_amount,
    COALESCE(pt.collected_amount, (0)::numeric) AS paid_amount,
    COALESCE(pt.collected_amount, (0)::numeric) AS total_paid,
    COALESCE(pt.collected_amount, (0)::numeric) AS collected_amount,
    COALESCE(pt.pending_amount, (0)::numeric) AS pending_amount,
    COALESCE(pt.overdue_pending_amount, (0)::numeric) AS overdue_amount,
    GREATEST((COALESCE(o.total_amount, (0)::numeric) - COALESCE(pt.collected_amount, (0)::numeric)), (0)::numeric) AS outstanding_amount,
    GREATEST((COALESCE(o.total_amount, (0)::numeric) - COALESCE(pt.collected_amount, (0)::numeric)), (0)::numeric) AS remaining_balance,
    COALESCE(pt.payment_count, (0)::bigint) AS payment_count,
        CASE
            WHEN (COALESCE(pt.collected_amount, (0)::numeric) <= (0)::numeric) THEN 'unpaid'::text
            WHEN ((COALESCE(pt.collected_amount, (0)::numeric) + 0.009) >= COALESCE(o.total_amount, (0)::numeric)) THEN 'paid'::text
            ELSE 'partial'::text
        END AS payment_status,
    pt.next_due_date,
    pt.last_payment_date
   FROM (public.orders o
     LEFT JOIN payment_totals pt ON ((pt.order_id = o.id)));


--
-- Name: worker_debt_items_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.worker_debt_items_view WITH (security_invoker = on) AS
 WITH session_items AS (
         SELECT 'session'::text AS source_type,
            s.id AS source_id,
            s.user_id,
            s.project_id,
            NULL::uuid AS payslip_id,
            NULL::uuid AS payroll_period_id,
            ((s.clock_in AT TIME ZONE 'utc'::text))::date AS source_date,
            ((s.clock_in AT TIME ZONE 'utc'::text))::date AS due_date,
            to_char(date_trunc('month'::text, s.clock_in), 'YYYY-MM'::text) AS period_month,
            (COALESCE(s.worked_minutes, 0))::numeric AS worked_minutes,
            (COALESCE(s.labor_cost, (0)::numeric))::numeric(12,2) AS earned_amount,
            (COALESCE(s.business_domain, 'general_business'::public.business_domain_enum))::text AS business_domain,
            s.property_id,
            COALESCE(s.is_billable_to_customer, false) AS is_billable_to_customer,
            s.bill_to_customer_amount
           FROM (public.attendance_sessions s
             JOIN public.users u ON ((u.id = s.user_id)))
          WHERE ((u.pay_tracking_mode = 'session'::text) AND (COALESCE(s.labor_cost, (0)::numeric) > (0)::numeric))
        ), payslip_items AS (
         SELECT 'payslip'::text AS source_type,
            p.id AS source_id,
            p.user_id,
            active_agreement.project_id,
            p.id AS payslip_id,
            p.payroll_period_id,
            COALESCE(pp.end_date, CURRENT_DATE) AS source_date,
            ((date_trunc('month'::text, ((COALESCE(pp.end_date, CURRENT_DATE))::timestamp without time zone + '1 mon'::interval)))::date + (LEAST(GREATEST(COALESCE(active_agreement.due_day_of_next_month, 10), 1), (EXTRACT(day FROM (date_trunc('month'::text, ((COALESCE(pp.end_date, CURRENT_DATE))::timestamp without time zone + '2 mons'::interval)) - '1 day'::interval)))::integer) - 1)) AS due_date,
            COALESCE(pp.period_month, to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text)) AS period_month,
            (COALESCE(p.total_work_minutes, 0))::numeric AS worked_minutes,
            (COALESCE(p.gross_salary, (0)::numeric))::numeric(12,2) AS earned_amount,
            COALESCE(active_agreement.business_domain, 'general_business'::text) AS business_domain,
            active_agreement.property_id,
            COALESCE(active_agreement.is_billable_to_customer, false) AS is_billable_to_customer,
            active_agreement.bill_to_customer_amount
           FROM (((public.payslips p
             JOIN public.users u ON ((u.id = p.user_id)))
             LEFT JOIN public.payroll_periods pp ON ((pp.id = p.payroll_period_id)))
             LEFT JOIN LATERAL ( SELECT sa.due_day_of_next_month,
                    sa.business_domain,
                    sa.project_id,
                    sa.property_id,
                    sa.is_billable_to_customer,
                    sa.bill_to_customer_amount
                   FROM public.salary_agreements sa
                  WHERE ((sa.user_id = p.user_id) AND (sa.valid_from <= COALESCE(pp.end_date, CURRENT_DATE)) AND ((sa.valid_to IS NULL) OR (sa.valid_to >= COALESCE(pp.end_date, CURRENT_DATE))))
                  ORDER BY sa.valid_from DESC, sa.id DESC
                 LIMIT 1) active_agreement ON (true))
          WHERE ((u.pay_tracking_mode = 'payslip'::text) AND (COALESCE(p.gross_salary, (0)::numeric) > (0)::numeric))
        ), base_items AS (
         SELECT session_items.source_type,
            session_items.source_id,
            session_items.user_id,
            session_items.project_id,
            session_items.payslip_id,
            session_items.payroll_period_id,
            session_items.source_date,
            session_items.due_date,
            session_items.period_month,
            session_items.worked_minutes,
            session_items.earned_amount,
            session_items.business_domain,
            session_items.property_id,
            session_items.is_billable_to_customer,
            session_items.bill_to_customer_amount
           FROM session_items
        UNION ALL
         SELECT payslip_items.source_type,
            payslip_items.source_id,
            payslip_items.user_id,
            payslip_items.project_id,
            payslip_items.payslip_id,
            payslip_items.payroll_period_id,
            payslip_items.source_date,
            payslip_items.due_date,
            payslip_items.period_month,
            payslip_items.worked_minutes,
            payslip_items.earned_amount,
            payslip_items.business_domain,
            payslip_items.property_id,
            payslip_items.is_billable_to_customer,
            payslip_items.bill_to_customer_amount
           FROM payslip_items
        ), allocation_totals AS (
         SELECT a_1.source_type,
            COALESCE(a_1.attendance_session_id, a_1.payslip_id) AS source_id,
            (sum(COALESCE(a_1.amount, (0)::numeric)))::numeric(12,2) AS paid_amount,
            max(wp.payment_date) AS last_payment_date
           FROM (public.worker_payment_allocations a_1
             JOIN public.worker_payments wp ON ((wp.id = a_1.worker_payment_id)))
          GROUP BY a_1.source_type, COALESCE(a_1.attendance_session_id, a_1.payslip_id)
        )
 SELECT b.source_type,
    b.source_id,
    b.user_id,
    b.project_id,
    b.payslip_id,
    b.payroll_period_id,
    b.source_date,
    b.period_month,
    b.worked_minutes,
    b.earned_amount,
    (COALESCE(a.paid_amount, (0)::numeric))::numeric(12,2) AS paid_amount,
    (
        CASE
            WHEN ((b.source_type = 'payslip'::text) AND (b.due_date > CURRENT_DATE)) THEN (0)::numeric
            ELSE (b.earned_amount - COALESCE(a.paid_amount, (0)::numeric))
        END)::numeric(12,2) AS owed_amount,
        CASE
            WHEN (abs((COALESCE(a.paid_amount, (0)::numeric) - b.earned_amount)) < 0.01) THEN 'paid'::text
            WHEN (COALESCE(a.paid_amount, (0)::numeric) > (b.earned_amount + 0.009)) THEN 'overpaid'::text
            WHEN ((b.source_type = 'payslip'::text) AND (b.due_date > CURRENT_DATE)) THEN 'not_due'::text
            WHEN ((COALESCE(a.paid_amount, (0)::numeric) > (0)::numeric) AND ((COALESCE(a.paid_amount, (0)::numeric) + 0.009) < b.earned_amount)) THEN 'partial'::text
            WHEN (COALESCE(a.paid_amount, (0)::numeric) <= (0)::numeric) THEN 'unpaid'::text
            ELSE 'overpaid'::text
        END AS payment_status,
    a.last_payment_date,
    b.due_date,
    b.business_domain,
    b.property_id,
    b.is_billable_to_customer,
    b.bill_to_customer_amount
   FROM (base_items b
     LEFT JOIN allocation_totals a ON (((a.source_type = b.source_type) AND (a.source_id = b.source_id))));


--
-- Name: project_financials_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.project_financials_view WITH (security_invoker = on) AS
 WITH expense_totals AS NOT MATERIALIZED (
         SELECT p_1.id AS project_id,
            COALESCE(sum(
                CASE
                    WHEN (COALESCE(pe.billed_to_customer, false) = true) THEN COALESCE(e.amount, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS billed_expense_amounts,
            COALESCE(sum(COALESCE(e.amount, (0)::numeric)), (0)::numeric) AS all_expense_costs
           FROM ((public.projects p_1
             LEFT JOIN public.project_expenses pe ON ((pe.project_id = p_1.id)))
             LEFT JOIN public.expenses e ON ((e.id = pe.expense_id)))
          GROUP BY p_1.id
        ), session_totals AS NOT MATERIALIZED (
         SELECT s.project_id,
            COALESCE(sum(
                CASE
                    WHEN (COALESCE(s.is_billable_to_customer, false) = false) THEN COALESCE(s.labor_cost, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS non_billable_labor_cost,
            COALESCE(sum(
                CASE
                    WHEN (COALESCE(s.is_billable_to_customer, false) = true) THEN COALESCE(s.bill_to_customer_amount, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS billable_session_amounts,
            COALESCE(sum(COALESCE(s.labor_cost, (0)::numeric)), (0)::numeric) AS all_labor_costs
           FROM public.attendance_sessions s
          WHERE (s.project_id IS NOT NULL)
          GROUP BY s.project_id
        ), payslip_salary_totals AS (
         SELECT d.project_id,
            COALESCE(sum(COALESCE(d.earned_amount, (0)::numeric)), (0)::numeric) AS payslip_salary_cost
           FROM public.worker_debt_items_view d
          WHERE ((d.source_type = 'payslip'::text) AND (d.project_id IS NOT NULL))
          GROUP BY d.project_id
        ), payslip_billed_totals AS NOT MATERIALIZED (
         SELECT d.project_id,
            COALESCE(sum(
                CASE
                    WHEN (COALESCE(d.is_billable_to_customer, false) = true) THEN COALESCE(d.bill_to_customer_amount, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS payslip_billed_amount
           FROM public.worker_debt_items_view d
          WHERE ((d.source_type = 'payslip'::text) AND (d.project_id IS NOT NULL))
          GROUP BY d.project_id
        ), payment_totals AS NOT MATERIALIZED (
         SELECT p_1.project_id,
            COALESCE(sum(
                CASE
                    WHEN (COALESCE(p_1.payment_status, 'cleared'::public.payment_status_enum) <> ALL (ARRAY['pending'::public.payment_status_enum, 'rejected'::public.payment_status_enum])) THEN COALESCE(p_1.net_amount, p_1.amount_total, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS collected_payments,
            COALESCE(sum(
                CASE
                    WHEN (p_1.payment_status = 'pending'::public.payment_status_enum) THEN COALESCE(p_1.net_amount, p_1.amount_total, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS pending_payments,
            COALESCE(sum(
                CASE
                    WHEN ((p_1.payment_status = 'pending'::public.payment_status_enum) AND (p_1.due_date IS NOT NULL) AND (p_1.due_date <= CURRENT_DATE)) THEN COALESCE(p_1.net_amount, p_1.amount_total, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS overdue_payments,
            COALESCE(sum(
                CASE
                    WHEN (COALESCE(p_1.payment_status, 'cleared'::public.payment_status_enum) <> ALL (ARRAY['pending'::public.payment_status_enum, 'rejected'::public.payment_status_enum])) THEN COALESCE(p_1.amount_total, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS gross_collected,
            COALESCE(sum(
                CASE
                    WHEN (COALESCE(p_1.payment_status, 'cleared'::public.payment_status_enum) <> ALL (ARRAY['pending'::public.payment_status_enum, 'rejected'::public.payment_status_enum])) THEN COALESCE(p_1.vat_amount, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS vat_collected,
            min(
                CASE
                    WHEN (p_1.payment_status = 'pending'::public.payment_status_enum) THEN p_1.due_date
                    ELSE NULL::date
                END) AS next_due_date,
            (max(
                CASE
                    WHEN (COALESCE(p_1.payment_status, 'cleared'::public.payment_status_enum) <> ALL (ARRAY['pending'::public.payment_status_enum, 'rejected'::public.payment_status_enum])) THEN p_1.payment_date
                    ELSE NULL::timestamp with time zone
                END))::date AS last_payment_date
           FROM public.payments p_1
          WHERE (p_1.project_id IS NOT NULL)
          GROUP BY p_1.project_id
        ), revenue_base AS (
         SELECT p_1.id AS project_id,
                CASE
                    WHEN (COALESCE(p_1.actual_price, (0)::numeric) > (0)::numeric) THEN (p_1.actual_price *
                    CASE
                        WHEN COALESCE(p_1.price_includes_vat, false) THEN ((1)::numeric + COALESCE(p_1.vat_rate, 0.18))
                        ELSE (1)::numeric
                    END)
                    WHEN (COALESCE(p_1.agreed_base_price, (0)::numeric) > (0)::numeric) THEN (p_1.agreed_base_price *
                    CASE
                        WHEN COALESCE(p_1.price_includes_vat, false) THEN ((1)::numeric + COALESCE(p_1.vat_rate, 0.18))
                        ELSE (1)::numeric
                    END)
                    ELSE COALESCE(pt_1.collected_payments, (0)::numeric)
                END AS base_revenue
           FROM (public.projects p_1
             LEFT JOIN payment_totals pt_1 ON ((pt_1.project_id = p_1.id)))
        ), effective_revenue AS (
         SELECT p_1.id AS project_id,
            GREATEST((((COALESCE(rb_1.base_revenue, (0)::numeric) + COALESCE(et_1.billed_expense_amounts, (0)::numeric)) + COALESCE(st_1.billable_session_amounts, (0)::numeric)) + COALESCE(pbt_1.payslip_billed_amount, (0)::numeric)), COALESCE(pt_1.collected_payments, (0)::numeric)) AS effective_price
           FROM (((((public.projects p_1
             LEFT JOIN revenue_base rb_1 ON ((rb_1.project_id = p_1.id)))
             LEFT JOIN expense_totals et_1 ON ((et_1.project_id = p_1.id)))
             LEFT JOIN session_totals st_1 ON ((st_1.project_id = p_1.id)))
             LEFT JOIN payslip_billed_totals pbt_1 ON ((pbt_1.project_id = p_1.id)))
             LEFT JOIN payment_totals pt_1 ON ((pt_1.project_id = p_1.id)))
        )
 SELECT p.id,
    p.name,
    p.agreed_base_price,
    p.actual_price,
    ((COALESCE(et.all_expense_costs, (0)::numeric) + COALESCE(st.all_labor_costs, (0)::numeric)) + COALESCE(ps.payslip_salary_cost, (0)::numeric)) AS total_expenses,
    (((COALESCE(er.effective_price, (0)::numeric) - COALESCE(et.all_expense_costs, (0)::numeric)) - COALESCE(st.all_labor_costs, (0)::numeric)) - COALESCE(ps.payslip_salary_cost, (0)::numeric)) AS gross_profit,
    ((COALESCE(et.billed_expense_amounts, (0)::numeric) + COALESCE(st.billable_session_amounts, (0)::numeric)) + COALESCE(pbt.payslip_billed_amount, (0)::numeric)) AS expenses_billed,
    COALESCE(er.effective_price, (0)::numeric) AS customer_total_price,
    COALESCE(pt.collected_payments, (0)::numeric) AS total_paid,
    COALESCE(pt.collected_payments, (0)::numeric) AS collected_amount,
    COALESCE(pt.pending_payments, (0)::numeric) AS pending_amount,
    COALESCE(pt.overdue_payments, (0)::numeric) AS overdue_amount,
    pt.next_due_date,
    pt.last_payment_date,
    GREATEST((COALESCE(er.effective_price, (0)::numeric) - COALESCE(pt.collected_payments, (0)::numeric)), (0)::numeric) AS outstanding_amount,
    p.price_includes_vat,
    p.vat_rate,
    COALESCE(pt.gross_collected, (0)::numeric) AS gross_collected,
    COALESCE(pt.vat_collected, (0)::numeric) AS vat_collected
   FROM (((((((public.projects p
     LEFT JOIN expense_totals et ON ((et.project_id = p.id)))
     LEFT JOIN session_totals st ON ((st.project_id = p.id)))
     LEFT JOIN payslip_salary_totals ps ON ((ps.project_id = p.id)))
     LEFT JOIN payslip_billed_totals pbt ON ((pbt.project_id = p.id)))
     LEFT JOIN revenue_base rb ON ((rb.project_id = p.id)))
     LEFT JOIN effective_revenue er ON ((er.project_id = p.id)))
     LEFT JOIN payment_totals pt ON ((pt.project_id = p.id)));


--
-- Name: collections_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.collections_view WITH (security_invoker = on) AS
 WITH sources AS (
         SELECT 'order'::text AS source_type,
            o.id AS source_id,
            o.customer_id,
            'sales'::text AS business_domain,
            (o.order_date)::date AS reference_date,
            COALESCE(ofv.total_amount, (0)::numeric) AS total_amount,
            COALESCE(ofv.collected_amount, (0)::numeric) AS collected_amount,
            COALESCE(ofv.pending_amount, (0)::numeric) AS pending_amount,
            COALESCE(ofv.overdue_amount, (0)::numeric) AS overdue_amount,
            COALESCE(ofv.outstanding_amount, (0)::numeric) AS outstanding_amount,
            ofv.next_due_date,
            ofv.last_payment_date
           FROM (public.orders o
             JOIN public.order_financials_view ofv ON ((ofv.order_id = o.id)))
          WHERE (COALESCE(o.status, ''::text) <> 'cancelled'::text)
        UNION ALL
         SELECT 'project'::text AS source_type,
            p.id AS source_id,
            p.customer_id,
            'logistics_projects'::text AS business_domain,
            p.start_date AS reference_date,
            COALESCE(pfv.customer_total_price, (0)::numeric) AS total_amount,
            COALESCE(pfv.collected_amount, (0)::numeric) AS collected_amount,
            COALESCE(pfv.pending_amount, (0)::numeric) AS pending_amount,
            COALESCE(pfv.overdue_amount, (0)::numeric) AS overdue_amount,
            COALESCE(pfv.outstanding_amount, (0)::numeric) AS outstanding_amount,
            pfv.next_due_date,
            pfv.last_payment_date
           FROM (public.projects p
             JOIN public.project_financials_view pfv ON ((pfv.id = p.id)))
          WHERE (COALESCE((p.status)::text, ''::text) <> 'cancelled'::text)
        )
 SELECT s.source_type,
    s.source_id,
    ((s.source_type || ':'::text) || (s.source_id)::text) AS collection_key,
    s.customer_id,
    COALESCE(NULLIF(TRIM(BOTH FROM c.name), ''::text), NULLIF(TRIM(BOTH FROM c.name_for_invoice), ''::text), 'לקוח'::text) AS customer_name,
    NULLIF(TRIM(BOTH FROM c.phone), ''::text) AS customer_phone,
    NULLIF(TRIM(BOTH FROM c.whatsapp), ''::text) AS customer_whatsapp,
    s.business_domain,
    s.reference_date,
    s.total_amount,
    s.collected_amount,
    s.pending_amount,
    s.overdue_amount,
    s.outstanding_amount,
    s.next_due_date,
    s.last_payment_date,
        CASE
            WHEN ((s.total_amount > (0)::numeric) AND ((s.collected_amount + 0.009) >= s.total_amount)) THEN 'collected'::text
            WHEN (s.overdue_amount > 0.009) THEN 'overdue'::text
            WHEN (s.pending_amount > 0.009) THEN 'awaiting'::text
            WHEN (s.collected_amount > 0.009) THEN 'partial'::text
            ELSE 'unpaid'::text
        END AS collection_status
   FROM (sources s
     LEFT JOIN public.customers c ON ((c.id = s.customer_id)))
  WHERE ((s.total_amount > 0.009) AND (s.outstanding_amount > 0.009));


--
-- Name: current_salary_agreements_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.current_salary_agreements_view WITH (security_invoker = on) AS
 SELECT DISTINCT ON (user_id) id,
    user_id,
    salary_type,
    hourly_rate,
    monthly_salary,
    overtime_rate,
    standard_daily_hours,
    valid_from,
    valid_to,
    notes
   FROM public.salary_agreements a
  WHERE ((valid_from <= CURRENT_DATE) AND ((valid_to IS NULL) OR (valid_to >= CURRENT_DATE)))
  ORDER BY user_id, valid_from DESC, id DESC;


--
-- Name: customer_activity_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.customer_activity_view AS
SELECT
    NULL::uuid AS customer_id,
    NULL::text AS name,
    NULL::timestamp with time zone AS last_order_at,
    NULL::timestamp with time zone AS last_payment_at,
    NULL::date AS last_project_start;


--
-- Name: customer_overview_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.customer_overview_view WITH (security_invoker = on) AS
 WITH order_totals AS (
         SELECT o.customer_id,
            count(*) AS orders_count,
            COALESCE(sum(COALESCE(o.total_amount, (0)::numeric)), (0)::numeric) AS total_sales,
            max(o.order_date) AS last_order_at
           FROM public.orders o
          WHERE (o.customer_id IS NOT NULL)
          GROUP BY o.customer_id
        ), project_totals AS (
         SELECT p.customer_id,
            count(*) AS projects_count,
            COALESCE(sum(COALESCE(pfv.customer_total_price, (0)::numeric)), (0)::numeric) AS project_total_sales
           FROM (public.projects p
             LEFT JOIN public.project_financials_view pfv ON ((pfv.id = p.id)))
          WHERE (p.customer_id IS NOT NULL)
          GROUP BY p.customer_id
        ), order_payment_totals AS (
         SELECT o.customer_id,
            COALESCE(sum(
                CASE
                    WHEN (COALESCE(pay.payment_status, 'cleared'::public.payment_status_enum) <> ALL (ARRAY['pending'::public.payment_status_enum, 'rejected'::public.payment_status_enum])) THEN COALESCE(pay.amount_total, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS collected,
            COALESCE(sum(
                CASE
                    WHEN (pay.payment_status = 'pending'::public.payment_status_enum) THEN COALESCE(pay.amount_total, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS pending,
            COALESCE(sum(
                CASE
                    WHEN ((pay.payment_status = 'pending'::public.payment_status_enum) AND (pay.due_date IS NOT NULL) AND (pay.due_date <= CURRENT_DATE)) THEN COALESCE(pay.amount_total, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS overdue,
            max(
                CASE
                    WHEN (COALESCE(pay.payment_status, 'cleared'::public.payment_status_enum) <> ALL (ARRAY['pending'::public.payment_status_enum, 'rejected'::public.payment_status_enum])) THEN pay.payment_date
                    ELSE NULL::timestamp with time zone
                END) AS last_payment_at
           FROM (public.payments pay
             JOIN public.orders o ON ((pay.order_id = o.id)))
          WHERE (o.customer_id IS NOT NULL)
          GROUP BY o.customer_id
        ), project_payment_totals AS (
         SELECT p.customer_id,
            COALESCE(sum(
                CASE
                    WHEN (COALESCE(pay.payment_status, 'cleared'::public.payment_status_enum) <> ALL (ARRAY['pending'::public.payment_status_enum, 'rejected'::public.payment_status_enum])) THEN COALESCE(pay.amount_total, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS collected,
            COALESCE(sum(
                CASE
                    WHEN (pay.payment_status = 'pending'::public.payment_status_enum) THEN COALESCE(pay.amount_total, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS pending,
            COALESCE(sum(
                CASE
                    WHEN ((pay.payment_status = 'pending'::public.payment_status_enum) AND (pay.due_date IS NOT NULL) AND (pay.due_date <= CURRENT_DATE)) THEN COALESCE(pay.amount_total, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS overdue,
            max(
                CASE
                    WHEN (COALESCE(pay.payment_status, 'cleared'::public.payment_status_enum) <> ALL (ARRAY['pending'::public.payment_status_enum, 'rejected'::public.payment_status_enum])) THEN pay.payment_date
                    ELSE NULL::timestamp with time zone
                END) AS last_payment_at
           FROM (public.payments pay
             JOIN public.projects p ON ((pay.project_id = p.id)))
          WHERE (p.customer_id IS NOT NULL)
          GROUP BY p.customer_id
        ), payment_totals AS (
         SELECT payments_union.customer_id,
            COALESCE(sum(payments_union.collected), (0)::numeric) AS total_paid,
            COALESCE(sum(payments_union.pending), (0)::numeric) AS expected_amount,
            COALESCE(sum(payments_union.overdue), (0)::numeric) AS overdue_amount,
            max(payments_union.last_payment_at) AS last_payment_at
           FROM ( SELECT order_payment_totals.customer_id,
                    order_payment_totals.collected,
                    order_payment_totals.pending,
                    order_payment_totals.overdue,
                    order_payment_totals.last_payment_at
                   FROM order_payment_totals
                UNION ALL
                 SELECT project_payment_totals.customer_id,
                    project_payment_totals.collected,
                    project_payment_totals.pending,
                    project_payment_totals.overdue,
                    project_payment_totals.last_payment_at
                   FROM project_payment_totals) payments_union
          GROUP BY payments_union.customer_id
        )
 SELECT c.id AS customer_id,
    COALESCE(NULLIF(TRIM(BOTH FROM c.name), ''::text), NULLIF(TRIM(BOTH FROM c.name_for_invoice), ''::text), 'לקוח'::text) AS customer_name,
    NULLIF(TRIM(BOTH FROM c.email), ''::text) AS email,
    NULLIF(TRIM(BOTH FROM c.phone), ''::text) AS phone,
    COALESCE(ot.orders_count, (0)::bigint) AS orders_count,
    COALESCE(pt.projects_count, (0)::bigint) AS projects_count,
    (COALESCE(ot.total_sales, (0)::numeric) + COALESCE(pt.project_total_sales, (0)::numeric)) AS total_sales,
    COALESCE(payt.total_paid, (0)::numeric) AS total_paid,
    GREATEST(((COALESCE(ot.total_sales, (0)::numeric) + COALESCE(pt.project_total_sales, (0)::numeric)) - COALESCE(payt.total_paid, (0)::numeric)), (0)::numeric) AS open_balance,
    ot.last_order_at,
    payt.last_payment_at,
    NULLIF(TRIM(BOTH FROM c.address), ''::text) AS address,
    COALESCE(c.active, true) AS active,
    NULLIF(TRIM(BOTH FROM c.notes), ''::text) AS notes,
    NULLIF(TRIM(BOTH FROM c.name_for_invoice), ''::text) AS name_for_invoice,
    NULLIF(TRIM(BOTH FROM c.registration_number), ''::text) AS registration_number,
    COALESCE(payt.expected_amount, (0)::numeric) AS expected_amount,
    COALESCE(payt.overdue_amount, (0)::numeric) AS overdue_amount
   FROM (((public.customers c
     LEFT JOIN order_totals ot ON ((ot.customer_id = c.id)))
     LEFT JOIN project_totals pt ON ((pt.customer_id = c.id)))
     LEFT JOIN payment_totals payt ON ((payt.customer_id = c.id)));


--
-- Name: customer_open_balance_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.customer_open_balance_view WITH (security_invoker = on) AS
 SELECT customer_id,
    customer_name,
    email,
    phone,
    orders_count,
    projects_count,
    total_sales,
    total_paid,
    open_balance,
    last_order_at,
    last_payment_at
   FROM public.customer_overview_view
  WHERE (open_balance > (0)::numeric);


--
-- Name: customer_orders_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.customer_orders_view AS
SELECT
    NULL::uuid AS order_id,
    NULL::uuid AS customer_id,
    NULL::text AS customer_name,
    NULL::text AS status,
    NULL::timestamp with time zone AS created_at,
    NULL::numeric AS total_amount,
    NULL::numeric AS paid_amount,
    NULL::numeric AS open_amount;


--
-- Name: customer_projects_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.customer_projects_view WITH (security_invoker = on) AS
 SELECT p.id AS project_id,
    p.customer_id,
    c.name AS customer_name,
    p.name AS project_name,
    p.status,
    p.start_date,
    p.end_date
   FROM (public.projects p
     JOIN public.customers c ON ((c.id = p.customer_id)));


--
-- Name: customer_sales_summary_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.customer_sales_summary_view AS
SELECT
    NULL::uuid AS customer_id,
    NULL::text AS customer_name,
    NULL::bigint AS order_count,
    NULL::numeric AS total_sales,
    NULL::numeric AS total_paid,
    NULL::numeric AS total_outstanding;


--
-- Name: delivery_overview_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.delivery_overview_view WITH (security_invoker = on) AS
 SELECT o.id AS order_id,
    o.customer_id,
    COALESCE(NULLIF(TRIM(BOTH FROM c.name), ''::text), NULLIF(TRIM(BOTH FROM c.name_for_invoice), ''::text), 'לקוח'::text) AS customer_name,
    NULLIF(TRIM(BOTH FROM c.phone), ''::text) AS customer_phone,
    NULLIF(TRIM(BOTH FROM c.address), ''::text) AS customer_address,
    NULLIF(TRIM(BOTH FROM split_part(COALESCE(c.address, ''::text), '|'::text, 1)), ''::text) AS customer_city,
    o.order_date,
    o.created_at,
    COALESCE(o.status, 'draft'::text) AS status,
    COALESCE(o.total_amount, (0)::numeric) AS total_amount,
    NULLIF(TRIM(BOTH FROM o.notes), ''::text) AS notes,
    o.branch_id,
    NULLIF(TRIM(BOTH FROM cb.name), ''::text) AS customer_branch_name,
    NULLIF(TRIM(BOTH FROM cb.address), ''::text) AS branch_address,
    NULLIF(TRIM(BOTH FROM cb.phone), ''::text) AS branch_phone,
    NULLIF(TRIM(BOTH FROM split_part(COALESCE(cb.address, ''::text), '|'::text, 1)), ''::text) AS branch_city
   FROM ((public.orders o
     LEFT JOIN public.customers c ON ((c.id = o.customer_id)))
     LEFT JOIN public.customer_branches cb ON ((cb.id = o.branch_id)))
  WHERE (COALESCE(o.status, ''::text) = ANY (ARRAY['draft'::text, 'confirmed'::text, 'processing'::text, 'out_for_delivery'::text, 'partially_delivered'::text]));


--
-- Name: document_overview_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.document_overview_view WITH (security_invoker = on) AS
 SELECT d.id AS document_id,
    d.document_type,
    d.title,
    d.file_name,
    d.uploaded_at,
    u.full_name AS uploaded_by,
    dl.entity_type,
    dl.entity_id
   FROM ((public.documents d
     LEFT JOIN public.users u ON ((u.id = d.uploaded_by)))
     LEFT JOIN public.document_links dl ON ((dl.document_id = d.id)));


--
-- Name: financial_expenses_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.financial_expenses_view WITH (security_invoker = on) AS
 SELECT e.id AS expense_id,
    e.expense_date,
    e.amount,
    e.category,
    e.description,
    e.recorded_by,
    pe.project_id,
    p.name AS project_name
   FROM ((public.expenses e
     LEFT JOIN public.project_expenses pe ON ((pe.expense_id = e.id)))
     LEFT JOIN public.projects p ON ((p.id = pe.project_id)));


--
-- Name: financial_payments_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.financial_payments_view WITH (security_invoker = on) AS
 SELECT p.id,
    p.payment_date,
    p.amount_total,
    p.payment_method,
    p.business_domain,
    o.customer_id,
    p.order_id
   FROM (public.payments p
     LEFT JOIN public.orders o ON ((o.id = p.order_id)));


--
-- Name: financial_project_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.financial_project_view WITH (security_invoker = on) AS
 WITH expense_totals AS (
         SELECT p_1.id AS project_id,
            COALESCE(sum(COALESCE(e.amount, (0)::numeric)), (0)::numeric) AS all_expense_costs
           FROM ((public.projects p_1
             LEFT JOIN public.project_expenses pe ON ((pe.project_id = p_1.id)))
             LEFT JOIN public.expenses e ON ((e.id = pe.expense_id)))
          GROUP BY p_1.id
        ), session_totals AS (
         SELECT s.project_id,
            COALESCE(sum(COALESCE(s.labor_cost, (0)::numeric)), (0)::numeric) AS all_labor_costs
           FROM public.attendance_sessions s
          WHERE (s.project_id IS NOT NULL)
          GROUP BY s.project_id
        )
 SELECT p.id AS project_id,
    p.name AS project_name,
    (COALESCE(et.all_expense_costs, (0)::numeric) + COALESCE(st.all_labor_costs, (0)::numeric)) AS total_expenses
   FROM ((public.projects p
     LEFT JOIN expense_totals et ON ((et.project_id = p.id)))
     LEFT JOIN session_totals st ON ((st.project_id = p.id)));


--
-- Name: monthly_worker_balance_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.monthly_worker_balance_view WITH (security_invoker = on) AS
 SELECT period_month,
    count(*) AS item_count,
    count(*) FILTER (WHERE (owed_amount > 0.009)) AS open_item_count,
    (sum(earned_amount))::numeric(12,2) AS earned_amount,
    (sum(paid_amount))::numeric(12,2) AS paid_amount,
    (sum(owed_amount))::numeric(12,2) AS owed_amount
   FROM public.worker_debt_items_view d
  WHERE (period_month IS NOT NULL)
  GROUP BY period_month;


--
-- Name: project_overview_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.project_overview_view WITH (security_invoker = on) AS
 SELECT p.id,
    p.name,
    p.status,
    p.project_type,
    p.start_date,
    p.end_date,
    p.agreed_base_price,
    p.actual_price,
    p.expenses_billed_separately,
    c.id AS customer_id,
    c.name AS customer_name,
    u.id AS project_manager_id,
    u.full_name AS project_manager_name,
    p.created_at,
    p.updated_at
   FROM ((public.projects p
     JOIN public.customers c ON ((c.id = p.customer_id)))
     LEFT JOIN public.users u ON ((u.id = p.project_manager_id)));


--
-- Name: project_task_progress_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.project_task_progress_view WITH (security_invoker = on) AS
 SELECT p.id AS project_id,
    count(t.id) AS total_tasks,
    count(
        CASE
            WHEN (t.status = 'done'::public.task_status_enum) THEN 1
            ELSE NULL::integer
        END) AS completed_tasks,
    count(
        CASE
            WHEN (t.status <> 'done'::public.task_status_enum) THEN 1
            ELSE NULL::integer
        END) AS open_tasks
   FROM (public.projects p
     LEFT JOIN public.tasks t ON ((t.project_id = p.id)))
  GROUP BY p.id;


--
-- Name: project_dashboard_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.project_dashboard_view WITH (security_invoker = on) AS
 SELECT po.id,
    po.name,
    po.status,
    po.project_type,
    po.start_date,
    po.end_date,
    po.agreed_base_price,
    po.actual_price,
    po.expenses_billed_separately,
    po.customer_id,
    po.customer_name,
    po.project_manager_id,
    po.project_manager_name,
    po.created_at,
    po.updated_at,
    pf.total_expenses,
    pf.gross_profit,
    pt.total_tasks,
    pt.completed_tasks,
    pt.open_tasks
   FROM ((public.project_overview_view po
     LEFT JOIN public.project_financials_view pf ON ((pf.id = po.id)))
     LEFT JOIN public.project_task_progress_view pt ON ((pt.project_id = po.id)));


--
-- Name: task_overview_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.task_overview_view WITH (security_invoker = on) AS
 SELECT t.id AS task_id,
    t.subject,
    t.status,
    t.priority,
    t.due_date,
    t.project_id,
    p.name AS project_name,
    t.assigned_user_id,
    u.full_name AS assigned_user_name,
    t.created_at,
    t.updated_at,
    ((t.due_date < now()) AND (t.status <> 'done'::public.task_status_enum)) AS is_overdue
   FROM ((public.tasks t
     LEFT JOIN public.users u ON ((u.id = t.assigned_user_id)))
     LEFT JOIN public.projects p ON ((p.id = t.project_id)));


--
-- Name: operations_dashboard_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.operations_dashboard_view WITH (security_invoker = on) AS
 WITH month_bounds AS (
         SELECT (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))::date AS current_month_start,
            ((date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon'::interval))::date AS next_month_start,
            ((date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) - '1 mon'::interval))::date AS previous_month_start
        ), cash_flow_totals AS (
         SELECT COALESCE(sum(
                CASE
                    WHEN ((cfe.type = 'income'::text) AND (cfe.entry_date >= mb_1.current_month_start) AND (cfe.entry_date < mb_1.next_month_start)) THEN cfe.amount
                    ELSE (0)::numeric
                END), (0)::numeric) AS monthly_revenue,
            COALESCE(sum(
                CASE
                    WHEN ((cfe.type = 'income'::text) AND (cfe.entry_date >= mb_1.previous_month_start) AND (cfe.entry_date < mb_1.current_month_start)) THEN cfe.amount
                    ELSE (0)::numeric
                END), (0)::numeric) AS previous_month_revenue,
            COALESCE(sum(
                CASE
                    WHEN ((cfe.type = 'expense'::text) AND (cfe.entry_date >= mb_1.current_month_start) AND (cfe.entry_date < mb_1.next_month_start)) THEN cfe.amount
                    ELSE (0)::numeric
                END), (0)::numeric) AS monthly_expenses,
            COALESCE(sum(
                CASE
                    WHEN ((cfe.type = 'expense'::text) AND (cfe.entry_date >= mb_1.previous_month_start) AND (cfe.entry_date < mb_1.current_month_start)) THEN cfe.amount
                    ELSE (0)::numeric
                END), (0)::numeric) AS previous_month_expenses
           FROM (month_bounds mb_1
             LEFT JOIN public.cash_flow_entries_view cfe ON (true))
        ), project_counts AS (
         SELECT count(*) AS active_projects_count
           FROM public.project_dashboard_view pdv
          WHERE (lower(COALESCE((pdv.status)::text, ''::text)) <> ALL (ARRAY['completed'::text, 'cancelled'::text]))
        ), task_counts AS (
         SELECT count(*) FILTER (WHERE (lower(COALESCE((tov.status)::text, ''::text)) <> ALL (ARRAY['completed'::text, 'cancelled'::text]))) AS open_tasks_count,
            count(*) FILTER (WHERE (COALESCE(tov.is_overdue, false) = true)) AS overdue_tasks_count
           FROM public.task_overview_view tov
        ), inventory_counts AS (
         SELECT count(*) FILTER (WHERE ((COALESCE(i.quantity_on_hand, (0)::numeric) - COALESCE(i.quantity_reserved, (0)::numeric)) <= (5)::numeric)) AS low_inventory_count
           FROM public.inventory i
        )
 SELECT mb.current_month_start AS current_month,
    mb.previous_month_start AS previous_month,
    cft.monthly_revenue,
    cft.previous_month_revenue,
    cft.monthly_expenses,
    cft.previous_month_expenses,
    pc.active_projects_count,
    tc.open_tasks_count,
    tc.overdue_tasks_count,
    ic.low_inventory_count
   FROM ((((month_bounds mb
     CROSS JOIN cash_flow_totals cft)
     CROSS JOIN project_counts pc)
     CROSS JOIN task_counts tc)
     CROSS JOIN inventory_counts ic);


--
-- Name: order_items_detailed_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.order_items_detailed_view WITH (security_invoker = on) AS
 SELECT oi.order_id,
    o.customer_id,
    c.name AS customer_name,
    oi.product_id,
    p.name AS product_name,
    oi.quantity_ordered,
    oi.quantity_delivered,
    oi.unit_price,
    oi.discount_amount,
    oi.line_total
   FROM (((public.order_items oi
     JOIN public.orders o ON ((o.id = oi.order_id)))
     JOIN public.customers c ON ((c.id = o.customer_id)))
     JOIN public.products p ON ((p.id = oi.product_id)));


--
-- Name: order_overview_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.order_overview_view WITH (security_invoker = on) AS
 WITH payment_totals AS (
         SELECT p.order_id,
            count(*) AS payment_count,
            COALESCE(sum(
                CASE
                    WHEN (COALESCE(p.payment_status, 'cleared'::public.payment_status_enum) <> ALL (ARRAY['pending'::public.payment_status_enum, 'rejected'::public.payment_status_enum])) THEN COALESCE(p.amount_total, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS collected_amount,
            COALESCE(sum(
                CASE
                    WHEN (p.payment_status = 'pending'::public.payment_status_enum) THEN COALESCE(p.amount_total, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS pending_amount,
            COALESCE(sum(
                CASE
                    WHEN ((p.payment_status = 'pending'::public.payment_status_enum) AND (p.due_date IS NOT NULL) AND (p.due_date <= CURRENT_DATE)) THEN COALESCE(p.amount_total, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS overdue_pending_amount,
            min(
                CASE
                    WHEN (p.payment_status = 'pending'::public.payment_status_enum) THEN p.due_date
                    ELSE NULL::date
                END) AS next_due_date
           FROM public.payments p
          WHERE (p.order_id IS NOT NULL)
          GROUP BY p.order_id
        )
 SELECT o.id AS order_id,
    o.customer_id,
    COALESCE(NULLIF(TRIM(BOTH FROM c.name), ''::text), NULLIF(TRIM(BOTH FROM c.name_for_invoice), ''::text), 'לקוח'::text) AS customer_name,
    NULLIF(TRIM(BOTH FROM c.email), ''::text) AS customer_email,
    NULLIF(TRIM(BOTH FROM c.phone), ''::text) AS customer_phone,
    NULLIF(TRIM(BOTH FROM c.address), ''::text) AS customer_address,
    NULLIF(TRIM(BOTH FROM split_part(COALESCE(c.address, ''::text), '|'::text, 1)), ''::text) AS customer_city,
    o.order_date,
    o.created_at,
    COALESCE(o.status, 'draft'::text) AS status,
        CASE
            WHEN (COALESCE(pt.collected_amount, (0)::numeric) <= (0)::numeric) THEN 'unpaid'::text
            WHEN ((COALESCE(pt.collected_amount, (0)::numeric) + 0.009) >= COALESCE(o.total_amount, (0)::numeric)) THEN 'paid'::text
            ELSE 'partial'::text
        END AS payment_status,
    COALESCE(o.discount_amount, (0)::numeric) AS discount_amount,
    COALESCE(o.total_amount, (0)::numeric) AS total_amount,
    COALESCE(pt.collected_amount, (0)::numeric) AS total_paid,
    COALESCE(pt.collected_amount, (0)::numeric) AS collected_amount,
    COALESCE(pt.pending_amount, (0)::numeric) AS pending_amount,
    COALESCE(pt.overdue_pending_amount, (0)::numeric) AS overdue_amount,
    pt.next_due_date,
    GREATEST((COALESCE(o.total_amount, (0)::numeric) - COALESCE(pt.collected_amount, (0)::numeric)), (0)::numeric) AS remaining_balance,
    COALESCE(pt.payment_count, (0)::bigint) AS payment_count,
    o.created_by AS created_by_user_id,
    COALESCE(NULLIF(TRIM(BOTH FROM u.full_name), ''::text), NULLIF(TRIM(BOTH FROM u.email), ''::text)) AS created_by_name,
    NULLIF(TRIM(BOTH FROM o.notes), ''::text) AS notes,
    NULLIF(TRIM(BOTH FROM c.name_for_invoice), ''::text) AS customer_name_for_invoice,
    o.needs_invoice,
    o.invoice_sent_at,
    o.delivery_confirmed_at,
    o.branch_id,
    NULLIF(TRIM(BOTH FROM cb.name), ''::text) AS customer_branch_name
   FROM ((((public.orders o
     LEFT JOIN public.customers c ON ((c.id = o.customer_id)))
     LEFT JOIN payment_totals pt ON ((pt.order_id = o.id)))
     LEFT JOIN public.users u ON ((u.id = o.created_by)))
     LEFT JOIN public.customer_branches cb ON ((cb.id = o.branch_id)));


--
-- Name: payroll_period_summary_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.payroll_period_summary_view WITH (security_invoker = on) AS
 SELECT p.id,
    p.period_month,
    p.start_date,
    p.end_date,
    p.status,
    count(DISTINCT ps.id) AS payslips_count,
    count(DISTINCT ps.id) FILTER (WHERE (p.status <> 'paid'::text)) AS unpaid_payslips_count,
    sum(COALESCE(ps.gross_salary, (0)::numeric)) AS gross_salary_total
   FROM (public.payroll_periods p
     LEFT JOIN public.payslips ps ON ((ps.payroll_period_id = p.id)))
  GROUP BY p.id, p.period_month, p.start_date, p.end_date, p.status;


--
-- Name: products_with_last_used; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.products_with_last_used WITH (security_invoker = on) AS
 SELECT p.id,
    p.sku,
    p.barcode,
    p.name,
    p.category_id,
    p.description,
    p.base_price,
    p.base_cost,
    p.active,
    p.created_at,
    p.updated_at,
    p.low_stock_threshold,
    os.last_used_at,
    COALESCE(os.order_count, (0)::bigint) AS order_count
   FROM (public.products p
     LEFT JOIN public.product_order_stats() os(product_id, order_count, last_used_at) ON ((os.product_id = p.id)));


--
-- Name: profit_and_loss_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.profit_and_loss_view WITH (security_invoker = on) AS
 SELECT sum(income) AS total_income,
    sum(expense) AS total_expenses,
    (sum(income) - sum(expense)) AS net_profit
   FROM ( SELECT payments.amount_total AS income,
            0 AS expense
           FROM public.payments
        UNION ALL
         SELECT 0 AS income,
            expenses.amount AS expense
           FROM public.expenses) x;


--
-- Name: project_documents_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.project_documents_view WITH (security_invoker = on) AS
 SELECT dl.entity_id AS project_id,
    d.id AS document_id,
    d.document_type,
    d.title,
    d.file_name,
    d.storage_key,
    d.uploaded_at,
    d.uploaded_by AS uploaded_by_user_id,
    u.full_name AS uploaded_by_name,
    d.notes
   FROM ((public.document_links dl
     JOIN public.documents d ON ((d.id = dl.document_id)))
     LEFT JOIN public.users u ON ((u.id = d.uploaded_by)))
  WHERE (dl.entity_type = 'project'::text);


--
-- Name: project_expenses_summary_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.project_expenses_summary_view WITH (security_invoker = on) AS
 WITH expense_totals AS (
         SELECT p_1.id AS project_id,
            count(pe.id) AS expense_count,
            COALESCE(sum(
                CASE
                    WHEN (COALESCE(pe.billed_to_customer, false) = false) THEN COALESCE(e.amount, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS total_expenses,
            COALESCE(sum(
                CASE
                    WHEN ((COALESCE(pe.included_in_base_price, false) = true) AND (COALESCE(pe.billed_to_customer, false) = false)) THEN COALESCE(e.amount, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS expenses_included,
            COALESCE(sum(
                CASE
                    WHEN (COALESCE(pe.billed_to_customer, false) = true) THEN COALESCE(e.amount, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS billed_expense_amounts,
            COALESCE(sum(COALESCE(e.amount, (0)::numeric)), (0)::numeric) AS all_expense_costs
           FROM ((public.projects p_1
             LEFT JOIN public.project_expenses pe ON ((pe.project_id = p_1.id)))
             LEFT JOIN public.expenses e ON ((e.id = pe.expense_id)))
          GROUP BY p_1.id
        ), session_totals AS (
         SELECT s.project_id,
            COALESCE(sum(
                CASE
                    WHEN (COALESCE(s.is_billable_to_customer, false) = false) THEN COALESCE(s.labor_cost, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS non_billable_labor_cost,
            COALESCE(sum(
                CASE
                    WHEN (COALESCE(s.is_billable_to_customer, false) = true) THEN COALESCE(s.bill_to_customer_amount, (0)::numeric)
                    ELSE (0)::numeric
                END), (0)::numeric) AS billable_session_amounts,
            COALESCE(sum(COALESCE(s.labor_cost, (0)::numeric)), (0)::numeric) AS all_labor_costs
           FROM public.attendance_sessions s
          WHERE (s.project_id IS NOT NULL)
          GROUP BY s.project_id
        )
 SELECT p.id AS project_id,
    COALESCE(et.expense_count, (0)::bigint) AS expense_count,
    (COALESCE(et.all_expense_costs, (0)::numeric) + COALESCE(st.all_labor_costs, (0)::numeric)) AS total_expenses,
    COALESCE(et.expenses_included, (0)::numeric) AS expenses_included,
    (COALESCE(et.billed_expense_amounts, (0)::numeric) + COALESCE(st.billable_session_amounts, (0)::numeric)) AS expenses_billed
   FROM ((public.projects p
     LEFT JOIN expense_totals et ON ((et.project_id = p.id)))
     LEFT JOIN session_totals st ON ((st.project_id = p.id)));


--
-- Name: project_worker_balance_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.project_worker_balance_view WITH (security_invoker = on) AS
 SELECT project_id,
    count(*) AS item_count,
    (sum(earned_amount))::numeric(12,2) AS earned_amount,
    (sum(paid_amount))::numeric(12,2) AS paid_amount,
    (sum(owed_amount))::numeric(12,2) AS owed_amount
   FROM public.worker_debt_items_view d
  WHERE (project_id IS NOT NULL)
  GROUP BY project_id;


--
-- Name: worker_attendance_monthly_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.worker_attendance_monthly_view WITH (security_invoker = on) AS
 SELECT user_id,
    to_char(date_trunc('month'::text, clock_in), 'YYYY-MM'::text) AS period_month,
    sum(COALESCE(worked_minutes, 0)) AS total_work_minutes,
    count(*) AS sessions_count,
    count(*) FILTER (WHERE (clock_out IS NULL)) AS open_sessions_count
   FROM public.attendance_sessions s
  GROUP BY user_id, (date_trunc('month'::text, clock_in));


--
-- Name: salary_center_worker_overview_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.salary_center_worker_overview_view WITH (security_invoker = on) AS
 WITH current_month AS (
         SELECT to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY-MM'::text) AS period_month
        ), attendance AS (
         SELECT w.user_id,
            w.total_work_minutes,
            w.sessions_count,
            w.open_sessions_count
           FROM (public.worker_attendance_monthly_view w
             JOIN current_month cm ON ((cm.period_month = w.period_month)))
        ), project_counts AS (
         SELECT s.user_id,
            count(DISTINCT COALESCE((s.project_id)::text, (s.property_id)::text)) AS current_month_links_count
           FROM (public.attendance_sessions s
             JOIN current_month cm ON ((cm.period_month = to_char(date_trunc('month'::text, s.clock_in), 'YYYY-MM'::text))))
          GROUP BY s.user_id
        )
 SELECT u.id AS user_id,
    u.full_name,
    u.email,
    u.phone,
    u.role,
    u.active,
    u.system_access,
    COALESCE(a.total_work_minutes, (0)::bigint) AS current_month_work_minutes,
    COALESCE(a.sessions_count, (0)::bigint) AS current_month_sessions_count,
    COALESCE(a.open_sessions_count, (0)::bigint) AS current_month_open_sessions_count,
    COALESCE(pc.current_month_links_count, (0)::bigint) AS current_month_links_count
   FROM ((public.users u
     LEFT JOIN attendance a ON ((a.user_id = u.id)))
     LEFT JOIN project_counts pc ON ((pc.user_id = u.id)))
  WHERE (u.role = ANY (ARRAY['worker'::public.user_role_enum, 'worker_no_access'::public.user_role_enum]));


--
-- Name: sales_financials_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.sales_financials_view AS
SELECT
    NULL::uuid AS order_id,
    NULL::uuid AS customer_id,
    NULL::timestamp with time zone AS created_at,
    NULL::numeric AS total_amount,
    NULL::numeric AS paid_amount,
    NULL::numeric AS open_amount;


--
-- Name: session_effective_payment_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.session_effective_payment_view WITH (security_invoker = on) AS
 WITH payslip_status AS (
         SELECT d.user_id,
            d.period_month,
            d.payment_status,
            d.last_payment_date,
            d.due_date
           FROM public.worker_debt_items_view d
          WHERE (d.source_type = 'payslip'::text)
        )
 SELECT s.id AS session_id,
    s.user_id,
    to_char(date_trunc('month'::text, s.clock_in), 'YYYY-MM'::text) AS period_month,
    (u.pay_tracking_mode = 'payslip'::text) AS is_payslip_covered,
        CASE
            WHEN (u.pay_tracking_mode = 'payslip'::text) THEN ps.payment_status
            ELSE sd.payment_status
        END AS payment_status,
        CASE
            WHEN (u.pay_tracking_mode = 'payslip'::text) THEN NULL::numeric
            ELSE sd.paid_amount
        END AS paid_amount,
        CASE
            WHEN (u.pay_tracking_mode = 'payslip'::text) THEN NULL::numeric
            ELSE sd.owed_amount
        END AS owed_amount,
        CASE
            WHEN (u.pay_tracking_mode = 'payslip'::text) THEN ps.last_payment_date
            ELSE sd.last_payment_date
        END AS last_payment_date,
        CASE
            WHEN (u.pay_tracking_mode = 'payslip'::text) THEN ps.due_date
            ELSE sd.due_date
        END AS due_date
   FROM (((public.attendance_sessions s
     JOIN public.users u ON ((u.id = s.user_id)))
     LEFT JOIN public.worker_debt_items_view sd ON (((sd.source_type = 'session'::text) AND (sd.source_id = s.id))))
     LEFT JOIN payslip_status ps ON (((ps.user_id = s.user_id) AND (ps.period_month = to_char(date_trunc('month'::text, s.clock_in), 'YYYY-MM'::text)))));


--
-- Name: worker_balance_summary_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.worker_balance_summary_view WITH (security_invoker = on) AS
 WITH item_agg AS (
         SELECT d.user_id,
            count(*) AS item_count,
            count(*) FILTER (WHERE (d.owed_amount > 0.009)) AS open_item_count,
            sum(d.earned_amount) AS earned_amount,
            sum(d.owed_amount) AS items_owed_amount,
            count(*) FILTER (WHERE ((d.owed_amount > 0.009) AND (d.payment_status = 'partial'::text))) AS partial_open_count,
            count(*) FILTER (WHERE ((d.owed_amount > 0.009) AND (d.payment_status = 'unpaid'::text))) AS unpaid_open_count,
            count(*) FILTER (WHERE (d.payment_status = 'not_due'::text)) AS not_due_count,
            max(d.last_payment_date) AS last_alloc_date
           FROM public.worker_debt_items_view d
          GROUP BY d.user_id
        ), payment_agg AS (
         SELECT wp.user_id,
            (sum(COALESCE(wp.amount, (0)::numeric)))::numeric(12,2) AS total_paid,
            max(wp.payment_date) AS last_payment_date
           FROM public.worker_payments wp
          GROUP BY wp.user_id
        ), alloc_agg AS (
         SELECT wp.user_id,
            (sum(COALESCE(a.amount, (0)::numeric)))::numeric(12,2) AS total_allocated
           FROM (public.worker_payment_allocations a
             JOIN public.worker_payments wp ON ((wp.id = a.worker_payment_id)))
          GROUP BY wp.user_id
        ), ids AS (
         SELECT item_agg.user_id
           FROM item_agg
        UNION
         SELECT payment_agg.user_id
           FROM payment_agg
        )
 SELECT ids.user_id,
    COALESCE(i.item_count, (0)::bigint) AS item_count,
    COALESCE(i.open_item_count, (0)::bigint) AS open_item_count,
    (COALESCE(i.earned_amount, (0)::numeric))::numeric(12,2) AS earned_amount,
    (COALESCE(p.total_paid, (0)::numeric))::numeric(12,2) AS paid_amount,
    ((COALESCE(i.items_owed_amount, (0)::numeric) - GREATEST((COALESCE(p.total_paid, (0)::numeric) - COALESCE(al.total_allocated, (0)::numeric)), (0)::numeric)))::numeric(12,2) AS owed_amount,
        CASE
            WHEN ((COALESCE(i.items_owed_amount, (0)::numeric) - GREATEST((COALESCE(p.total_paid, (0)::numeric) - COALESCE(al.total_allocated, (0)::numeric)), (0)::numeric)) < '-0.009'::numeric) THEN 'overpaid'::text
            WHEN (COALESCE(i.partial_open_count, (0)::bigint) > 0) THEN 'partial'::text
            WHEN (COALESCE(i.unpaid_open_count, (0)::bigint) > 0) THEN 'unpaid'::text
            WHEN (COALESCE(i.not_due_count, (0)::bigint) > 0) THEN 'not_due'::text
            ELSE 'paid'::text
        END AS payment_status,
    GREATEST(i.last_alloc_date, p.last_payment_date) AS last_payment_date
   FROM (((ids
     LEFT JOIN item_agg i ON ((i.user_id = ids.user_id)))
     LEFT JOIN payment_agg p ON ((p.user_id = ids.user_id)))
     LEFT JOIN alloc_agg al ON ((al.user_id = ids.user_id)));


--
-- Name: worker_project_hours_view; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.worker_project_hours_view WITH (security_invoker = on) AS
 SELECT user_id,
    project_id,
    sum(COALESCE(worked_minutes, 0)) AS total_work_minutes,
    sum(COALESCE(labor_cost, (0)::numeric)) AS total_labor_cost
   FROM public.attendance_sessions s
  WHERE (project_id IS NOT NULL)
  GROUP BY user_id, project_id;


--
-- Name: customer_activity_view _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.customer_activity_view WITH (security_invoker = on) AS
 SELECT c.id AS customer_id,
    c.name,
    max(o.created_at) AS last_order_at,
    max(p.payment_date) AS last_payment_at,
    max(pr.start_date) AS last_project_start
   FROM (((public.customers c
     LEFT JOIN public.orders o ON ((o.customer_id = c.id)))
     LEFT JOIN public.payments p ON ((p.order_id = o.id)))
     LEFT JOIN public.projects pr ON ((pr.customer_id = c.id)))
  GROUP BY c.id;


--
-- Name: customer_orders_view _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.customer_orders_view WITH (security_invoker = on) AS
 SELECT o.id AS order_id,
    o.customer_id,
    c.name AS customer_name,
    o.status,
    o.created_at,
    o.total_amount,
    COALESCE(sum(p.amount_total), (0)::numeric) AS paid_amount,
    (o.total_amount - COALESCE(sum(p.amount_total), (0)::numeric)) AS open_amount
   FROM ((public.orders o
     JOIN public.customers c ON ((c.id = o.customer_id)))
     LEFT JOIN public.payments p ON ((p.order_id = o.id)))
  GROUP BY o.id, c.name;


--
-- Name: customer_sales_summary_view _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.customer_sales_summary_view WITH (security_invoker = on) AS
 SELECT c.id AS customer_id,
    c.name AS customer_name,
    count(o.id) AS order_count,
    COALESCE(sum(o.total_amount), (0)::numeric) AS total_sales,
    COALESCE(sum(p.amount_total), (0)::numeric) AS total_paid,
    (COALESCE(sum(o.total_amount), (0)::numeric) - COALESCE(sum(p.amount_total), (0)::numeric)) AS total_outstanding
   FROM ((public.customers c
     LEFT JOIN public.orders o ON ((o.customer_id = c.id)))
     LEFT JOIN public.payments p ON ((p.order_id = o.id)))
  GROUP BY c.id;


--
-- Name: sales_financials_view _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.sales_financials_view WITH (security_invoker = on) AS
 SELECT o.id AS order_id,
    o.customer_id,
    o.created_at,
    o.total_amount,
    COALESCE(sum(p.amount_total), (0)::numeric) AS paid_amount,
    (o.total_amount - COALESCE(sum(p.amount_total), (0)::numeric)) AS open_amount
   FROM (public.orders o
     LEFT JOIN public.payments p ON ((p.order_id = o.id)))
  GROUP BY o.id;

-- ===== triggers =====
--
-- Name: payslip_items payslip_items_attach; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payslip_items_attach BEFORE INSERT OR UPDATE OF payslip_id, item_date, user_id ON public.payslip_items FOR EACH ROW EXECUTE FUNCTION public.payslip_items_attach_to_payslip();


--
-- Name: payslip_items payslip_items_recalc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payslip_items_recalc AFTER INSERT OR DELETE OR UPDATE ON public.payslip_items FOR EACH ROW EXECUTE FUNCTION public.payslip_items_recalc_gross();


--
-- Name: reminders reminders_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reminders_set_updated_at BEFORE UPDATE ON public.reminders FOR EACH ROW EXECUTE FUNCTION public.set_reminders_updated_at();


--
-- Name: task_comments task_comments_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER task_comments_set_updated_at BEFORE UPDATE ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.set_task_comments_updated_at();


--
-- Name: account_transfers trg_audit_account_transfers; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_account_transfers AFTER INSERT OR DELETE OR UPDATE ON public.account_transfers FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: accounts trg_audit_accounts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_accounts AFTER INSERT OR DELETE OR UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: attendance_sessions trg_audit_attendance_sessions; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_attendance_sessions AFTER INSERT OR DELETE OR UPDATE ON public.attendance_sessions FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: card_account_mappings trg_audit_card_account_mappings; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_card_account_mappings AFTER INSERT OR DELETE OR UPDATE ON public.card_account_mappings FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: card_statement_charges trg_audit_card_statement_charges; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_card_statement_charges AFTER INSERT OR DELETE OR UPDATE ON public.card_statement_charges FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: card_statements trg_audit_card_statements; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_card_statements AFTER INSERT OR DELETE OR UPDATE ON public.card_statements FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: communication_logs trg_audit_communication_logs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_communication_logs AFTER INSERT OR DELETE OR UPDATE ON public.communication_logs FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: document_links trg_audit_document_links; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_document_links AFTER INSERT OR DELETE OR UPDATE ON public.document_links FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: documents trg_audit_documents; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_documents AFTER INSERT OR DELETE OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: dunning_stages trg_audit_dunning_stages; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_dunning_stages AFTER INSERT OR DELETE OR UPDATE ON public.dunning_stages FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: entity_tags trg_audit_entity_tags; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_entity_tags AFTER INSERT OR DELETE OR UPDATE ON public.entity_tags FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: hourly_salary_overrides trg_audit_hourly_salary_overrides; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_hourly_salary_overrides AFTER INSERT OR DELETE OR UPDATE ON public.hourly_salary_overrides FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: inventory_movements trg_audit_inventory_movements; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_inventory_movements AFTER INSERT OR DELETE OR UPDATE ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: lease_agreements trg_audit_lease_agreements; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_lease_agreements AFTER INSERT OR DELETE OR UPDATE ON public.lease_agreements FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: loan_repayments trg_audit_loan_repayments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_loan_repayments AFTER INSERT OR DELETE OR UPDATE ON public.loan_repayments FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: loans trg_audit_loans; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_loans AFTER INSERT OR DELETE OR UPDATE ON public.loans FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: contacts trg_audit_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_orders AFTER INSERT OR DELETE OR UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: customers trg_audit_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_orders AFTER INSERT OR DELETE OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: expenses trg_audit_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_orders AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: order_items trg_audit_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_orders AFTER INSERT OR DELETE OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: orders trg_audit_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_orders AFTER INSERT OR DELETE OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: payments trg_audit_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_orders AFTER INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: projects trg_audit_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_orders AFTER INSERT OR DELETE OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: tasks trg_audit_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_orders AFTER INSERT OR DELETE OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: users trg_audit_orders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_orders AFTER INSERT OR DELETE OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: payment_promises trg_audit_payment_promises; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_payment_promises AFTER INSERT OR DELETE OR UPDATE ON public.payment_promises FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: payroll_periods trg_audit_payroll_periods; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_payroll_periods AFTER INSERT OR DELETE OR UPDATE ON public.payroll_periods FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: payslip_items trg_audit_payslip_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_payslip_items AFTER INSERT OR DELETE OR UPDATE ON public.payslip_items FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: payslips trg_audit_payslips; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_payslips AFTER INSERT OR DELETE OR UPDATE ON public.payslips FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: phone_attendance_reports trg_audit_phone_attendance_reports; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_phone_attendance_reports AFTER INSERT OR DELETE OR UPDATE ON public.phone_attendance_reports FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: product_categories trg_audit_product_categories; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_product_categories AFTER INSERT OR DELETE OR UPDATE ON public.product_categories FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: products trg_audit_products; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_products AFTER INSERT OR DELETE OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: project_expenses trg_audit_project_expenses; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_project_expenses AFTER INSERT OR DELETE OR UPDATE ON public.project_expenses FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: properties trg_audit_properties; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_properties AFTER INSERT OR DELETE OR UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: push_alert_config trg_audit_push_alert_config; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_push_alert_config AFTER INSERT OR DELETE OR UPDATE ON public.push_alert_config FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: recurring_expense_templates trg_audit_recurring_expense_templates; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_recurring_expense_templates AFTER INSERT OR DELETE OR UPDATE ON public.recurring_expense_templates FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: recurring_task_template_assignees trg_audit_recurring_task_template_assignees; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_recurring_task_template_assignees AFTER INSERT OR DELETE OR UPDATE ON public.recurring_task_template_assignees FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: recurring_task_templates trg_audit_recurring_task_templates; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_recurring_task_templates AFTER INSERT OR DELETE OR UPDATE ON public.recurring_task_templates FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: salary_agreements trg_audit_salary_agreements; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_salary_agreements AFTER INSERT OR DELETE OR UPDATE ON public.salary_agreements FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: tags trg_audit_tags; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_tags AFTER INSERT OR DELETE OR UPDATE ON public.tags FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: task_comments trg_audit_task_comments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_task_comments AFTER INSERT OR DELETE OR UPDATE ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: vehicles trg_audit_vehicles; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_vehicles AFTER INSERT OR DELETE OR UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: worker_absences trg_audit_worker_absences; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_worker_absences AFTER INSERT OR DELETE OR UPDATE ON public.worker_absences FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: worker_payment_allocations trg_audit_worker_payment_allocations; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_worker_payment_allocations AFTER INSERT OR DELETE OR UPDATE ON public.worker_payment_allocations FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: worker_payments trg_audit_worker_payments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_worker_payments AFTER INSERT OR DELETE OR UPDATE ON public.worker_payments FOR EACH ROW EXECUTE FUNCTION public.log_changes();


--
-- Name: order_items trg_calculate_line_total; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_calculate_line_total BEFORE INSERT OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.calculate_line_total();


--
-- Name: tasks trg_close_task_reminders_on_status_close; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_close_task_reminders_on_status_close AFTER UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.close_task_reminders_on_status_close();


--
-- Name: payments trg_protect_payments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_payments BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.protect_payments();


--
-- Name: order_items trg_recalculate_order_totals; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recalculate_order_totals AFTER INSERT OR DELETE OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.recalculate_order_totals();


--
-- Name: inventory_movements trg_sync_inventory_from_movements; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_inventory_from_movements AFTER INSERT OR DELETE OR UPDATE ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION public.sync_inventory_from_movements();


--
-- Name: users trg_users_fill_auth_user_id; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_fill_auth_user_id BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.users_fill_auth_user_id_from_existing_auth();


--
-- Name: vehicle_mileage_readings vehicle_mileage_readings_sync; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER vehicle_mileage_readings_sync AFTER INSERT OR DELETE ON public.vehicle_mileage_readings FOR EACH ROW EXECUTE FUNCTION public.sync_vehicle_mileage_cache();


--
-- Name: worker_absences worker_absences_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER worker_absences_set_updated_at BEFORE UPDATE ON public.worker_absences FOR EACH ROW EXECUTE FUNCTION public.worker_ledger_touch_updated_at();

-- ===== RLS + policies =====
--
-- Name: account_transfers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_transfers ENABLE ROW LEVEL SECURITY;

--
-- Name: accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: business_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: card_account_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.card_account_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: card_statement_charges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.card_statement_charges ENABLE ROW LEVEL SECURITY;

--
-- Name: card_statement_rows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.card_statement_rows ENABLE ROW LEVEL SECURITY;

--
-- Name: card_statements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.card_statements ENABLE ROW LEVEL SECURITY;

--
-- Name: communication_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.communication_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_branches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_branches ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: document_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_links ENABLE ROW LEVEL SECURITY;

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: dunning_stages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dunning_stages ENABLE ROW LEVEL SECURITY;

--
-- Name: entity_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.entity_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_merchant_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expense_merchant_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: fcm_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fcm_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: hourly_salary_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hourly_salary_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: idempotency_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: lease_agreements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lease_agreements ENABLE ROW LEVEL SECURITY;

--
-- Name: loan_repayments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loan_repayments ENABLE ROW LEVEL SECURITY;

--
-- Name: loans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;

--
-- Name: morning_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.morning_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: morning_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.morning_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: order_delivery_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_delivery_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_promises; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_promises ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: payroll_periods; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;

--
-- Name: payslip_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payslip_items ENABLE ROW LEVEL SECURITY;

--
-- Name: payslips; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;

--
-- Name: phone_attendance_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.phone_attendance_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: product_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: project_expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: properties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

--
-- Name: push_alert_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_alert_config ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: recurring_expense_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recurring_expense_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: recurring_task_template_assignees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recurring_task_template_assignees ENABLE ROW LEVEL SECURITY;

--
-- Name: recurring_task_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recurring_task_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: reminders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

--
-- Name: salary_agreements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.salary_agreements ENABLE ROW LEVEL SECURITY;

--
-- Name: tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

--
-- Name: task_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: task_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_members ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: user_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicle_mileage_readings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_mileage_readings ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_absences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_absences ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_payment_allocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_payment_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: dunning_stages Admin manage dunning stages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin manage dunning stages" ON public.dunning_stages TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::public.user_role_enum) AND (u.active = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::public.user_role_enum) AND (u.active = true)))));


--
-- Name: morning_documents Admins and office can insert morning documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins and office can insert morning documents" ON public.morning_documents FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum]))))));


--
-- Name: recurring_expense_templates Admins and office can manage recurring expense templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins and office can manage recurring expense templates" ON public.recurring_expense_templates TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum]))))));


--
-- Name: recurring_task_template_assignees Admins and office can manage recurring task assignees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins and office can manage recurring task assignees" ON public.recurring_task_template_assignees TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum]))))));


--
-- Name: recurring_task_templates Admins and office can manage recurring task templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins and office can manage recurring task templates" ON public.recurring_task_templates TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum]))))));


--
-- Name: morning_documents Admins and office can update morning documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins and office can update morning documents" ON public.morning_documents FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum]))))));


--
-- Name: morning_documents Admins can delete morning documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete morning documents" ON public.morning_documents FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND (u.role = 'admin'::public.user_role_enum)))));


--
-- Name: morning_settings Admins can manage morning settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage morning settings" ON public.morning_settings TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND (u.role = 'admin'::public.user_role_enum))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND (u.role = 'admin'::public.user_role_enum)))));


--
-- Name: worker_payment_allocations Admins can manage worker payment allocations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage worker payment allocations" ON public.worker_payment_allocations TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::public.user_role_enum) AND (u.active = true) AND (COALESCE(u.system_access, false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::public.user_role_enum) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: worker_payments Admins can manage worker payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage worker payments" ON public.worker_payments TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::public.user_role_enum) AND (u.active = true) AND (COALESCE(u.system_access, false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::public.user_role_enum) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: reminders Assignee reads own reminders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Assignee reads own reminders" ON public.reminders FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.id = reminders.assigned_to) AND (u.active = true)))));


--
-- Name: reminders Assignee updates own reminders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Assignee updates own reminders" ON public.reminders FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.id = reminders.assigned_to) AND (u.active = true)))));


--
-- Name: entity_tags Authenticated use entity_tags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated use entity_tags" ON public.entity_tags TO authenticated USING (( SELECT (EXISTS ( SELECT 1
           FROM public.users u
          WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum, 'worker'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))) AS "exists")) WITH CHECK (( SELECT (EXISTS ( SELECT 1
           FROM public.users u
          WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum, 'worker'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))) AS "exists"));


--
-- Name: payslips Office can manage payslips; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Office can manage payslips" ON public.payslips TO authenticated USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: worker_payment_allocations Office can manage worker payment allocations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Office can manage worker payment allocations" ON public.worker_payment_allocations TO authenticated USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: worker_payments Office can manage worker payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Office can manage worker payments" ON public.worker_payments TO authenticated USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: salary_agreements Office can read salary agreements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Office can read salary agreements" ON public.salary_agreements FOR SELECT TO authenticated USING ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: communication_logs Office manages communication logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Office manages communication logs" ON public.communication_logs TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: order_delivery_recipients Office manages order_delivery_recipients; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Office manages order_delivery_recipients" ON public.order_delivery_recipients TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: reminders Office manages reminders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Office manages reminders" ON public.reminders TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: tags Read tags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Read tags" ON public.tags FOR SELECT TO authenticated USING (( SELECT (EXISTS ( SELECT 1
           FROM public.users u
          WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum, 'worker'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))) AS "exists"));


--
-- Name: vehicles Read vehicles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Read vehicles" ON public.vehicles FOR SELECT TO authenticated USING (true);


--
-- Name: order_delivery_recipients Recipient reads own delivery assignment; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Recipient reads own delivery assignment" ON public.order_delivery_recipients FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.id = order_delivery_recipients.user_id) AND (u.active = true)))));


--
-- Name: account_transfers Staff manage account transfers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff manage account transfers" ON public.account_transfers TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: accounts Staff manage accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff manage accounts" ON public.accounts TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: card_account_mappings Staff manage card account mappings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff manage card account mappings" ON public.card_account_mappings TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: card_statement_charges Staff manage card statement charges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff manage card statement charges" ON public.card_statement_charges TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: card_statement_rows Staff manage card statement rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff manage card statement rows" ON public.card_statement_rows TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: card_statements Staff manage card statements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff manage card statements" ON public.card_statements TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: loan_repayments Staff manage loan repayments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff manage loan repayments" ON public.loan_repayments TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: loans Staff manage loans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff manage loans" ON public.loans TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: expense_merchant_mappings Staff manage merchant mappings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff manage merchant mappings" ON public.expense_merchant_mappings TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: payment_promises Staff manage payment promises; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff manage payment promises" ON public.payment_promises TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: phone_attendance_reports Staff manage phone attendance reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff manage phone attendance reports" ON public.phone_attendance_reports TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: tags Staff manage tags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff manage tags" ON public.tags TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND ((u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) OR ((u.role = 'worker'::public.user_role_enum) AND (tags.kind = 'vehicle'::text) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND ((u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) OR ((u.role = 'worker'::public.user_role_enum) AND (tags.kind = 'vehicle'::text) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false)))))));


--
-- Name: vehicles Staff manage vehicles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff manage vehicles" ON public.vehicles TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND ((u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) OR ((u.role = 'worker'::public.user_role_enum) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND ((u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) OR ((u.role = 'worker'::public.user_role_enum) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false)))))));


--
-- Name: morning_documents System users can read morning documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "System users can read morning documents" ON public.morning_documents FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: morning_settings System users can read morning settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "System users can read morning settings" ON public.morning_settings FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: recurring_expense_templates System users can read recurring expense templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "System users can read recurring expense templates" ON public.recurring_expense_templates FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: recurring_task_template_assignees System users can read recurring task assignees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "System users can read recurring task assignees" ON public.recurring_task_template_assignees FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: recurring_task_templates System users can read recurring task templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "System users can read recurring task templates" ON public.recurring_task_templates FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: fcm_tokens Users manage own fcm tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own fcm tokens" ON public.fcm_tokens USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: push_subscriptions Users manage own subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own subscriptions" ON public.push_subscriptions USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: expenses admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_full_access ON public.expenses USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (public.is_admin());


--
-- Name: project_expenses admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_full_access ON public.project_expenses USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (public.is_admin());


--
-- Name: projects admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_full_access ON public.projects USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (public.is_admin());


--
-- Name: tasks admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_full_access ON public.tasks TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: users admin_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_full_access ON public.users USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: order_items admin_full_access_order_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_full_access_order_items ON public.order_items USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: orders admin_full_access_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_full_access_orders ON public.orders USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: payments admin_full_access_payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_full_access_payments ON public.payments USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (public.is_admin());


--
-- Name: audit_logs admin_read_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_read_logs ON public.audit_logs FOR SELECT USING (public.is_admin());


--
-- Name: attendance_sessions attendance_admin_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_admin_full ON public.attendance_sessions USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: attendance_sessions attendance_office_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_office_full ON public.attendance_sessions USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: attendance_sessions attendance_worker_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_worker_select_own ON public.attendance_sessions FOR SELECT TO authenticated USING ((user_id = public.current_app_user_id()));


--
-- Name: audit_logs audit_logs_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_logs_insert_authenticated ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: audit_logs audit_self_login_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_self_login_events ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (((table_name = 'auth'::text) AND (action = ANY (ARRAY['login'::text, 'logout'::text])) AND (changed_by = ( SELECT u.id
   FROM public.users u
  WHERE (u.auth_user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: business_settings business_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY business_settings_select ON public.business_settings FOR SELECT TO authenticated USING (true);


--
-- Name: business_settings business_settings_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY business_settings_write ON public.business_settings TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::public.user_role_enum))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'admin'::public.user_role_enum)))));


--
-- Name: customer_branches customer_branches_office_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_branches_office_manage ON public.customer_branches TO authenticated USING ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum]))) WITH CHECK ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])));


--
-- Name: customer_branches customer_branches_worker_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_branches_worker_select ON public.customer_branches FOR SELECT TO authenticated USING ((public.current_user_role() = 'worker'::public.user_role_enum));


--
-- Name: contacts customers_admin_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_admin_full ON public.contacts USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: customers customers_admin_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_admin_full ON public.customers USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: contacts customers_office_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_office_full ON public.contacts USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: customers customers_office_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_office_full ON public.customers USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: customers customers_worker_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_worker_select ON public.customers FOR SELECT TO authenticated USING ((public.current_user_role() = 'worker'::public.user_role_enum));


--
-- Name: customers customers_worker_update_delivery_location; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_worker_update_delivery_location ON public.customers FOR UPDATE TO authenticated USING ((public.current_user_role() = 'worker'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'worker'::public.user_role_enum));


--
-- Name: document_links document_links_admin_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_links_admin_full ON public.document_links USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: document_links document_links_office_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_links_office_full ON public.document_links USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: document_links document_links_worker_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_links_worker_insert ON public.document_links FOR INSERT WITH CHECK (((public.current_user_role() = 'worker'::public.user_role_enum) AND (entity_type = 'order'::text)));


--
-- Name: document_links document_links_worker_select_order; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_links_worker_select_order ON public.document_links FOR SELECT TO authenticated USING (((public.current_user_role() = 'worker'::public.user_role_enum) AND (entity_type = 'order'::text)));


--
-- Name: document_links document_links_worker_select_task; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_links_worker_select_task ON public.document_links FOR SELECT TO authenticated USING (((entity_type = 'task'::text) AND (( SELECT public.current_user_role() AS current_user_role) = 'worker'::public.user_role_enum) AND (EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE (t.id = document_links.entity_id)))));


--
-- Name: documents documents_admin_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_admin_full ON public.documents USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: documents documents_office_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_office_full ON public.documents USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: documents documents_worker_delete_vehicle_photo; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_worker_delete_vehicle_photo ON public.documents FOR DELETE TO authenticated USING (((document_type = 'vehicle_photo'::text) AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'worker'::public.user_role_enum) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false))))));


--
-- Name: documents documents_worker_delete_vehicle_tagged; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_worker_delete_vehicle_tagged ON public.documents FOR DELETE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'worker'::public.user_role_enum) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false)))) AND (EXISTS ( SELECT 1
   FROM (public.entity_tags et
     JOIN public.tags t ON ((t.id = et.tag_id)))
  WHERE ((et.entity_type = 'document'::text) AND (et.entity_id = documents.id) AND (t.kind = 'vehicle'::text))))));


--
-- Name: documents documents_worker_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_worker_insert ON public.documents FOR INSERT WITH CHECK (((public.current_user_role() = 'worker'::public.user_role_enum) AND (uploaded_by = ( SELECT auth.uid() AS uid))));


--
-- Name: documents documents_worker_select_order; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_worker_select_order ON public.documents FOR SELECT TO authenticated USING (((public.current_user_role() = 'worker'::public.user_role_enum) AND (EXISTS ( SELECT 1
   FROM public.document_links dl
  WHERE ((dl.document_id = documents.id) AND (dl.entity_type = 'order'::text))))));


--
-- Name: documents documents_worker_select_task_linked; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_worker_select_task_linked ON public.documents FOR SELECT TO authenticated USING (((( SELECT public.current_user_role() AS current_user_role) = 'worker'::public.user_role_enum) AND (EXISTS ( SELECT 1
   FROM public.document_links dl
  WHERE ((dl.document_id = documents.id) AND (dl.entity_type = 'task'::text))))));


--
-- Name: documents documents_worker_select_vehicle_photo; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_worker_select_vehicle_photo ON public.documents FOR SELECT TO authenticated USING (((document_type = 'vehicle_photo'::text) AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'worker'::public.user_role_enum) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false))))));


--
-- Name: documents documents_worker_select_vehicle_tagged; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_worker_select_vehicle_tagged ON public.documents FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'worker'::public.user_role_enum) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false)))) AND (EXISTS ( SELECT 1
   FROM (public.entity_tags et
     JOIN public.tags t ON ((t.id = et.tag_id)))
  WHERE ((et.entity_type = 'document'::text) AND (et.entity_id = documents.id) AND (t.kind = 'vehicle'::text))))));


--
-- Name: expenses expenses_office_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expenses_office_full ON public.expenses USING ((( SELECT public.current_user_role() AS current_user_role) = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: expenses expenses_worker_delete_vehicle_tagged; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expenses_worker_delete_vehicle_tagged ON public.expenses FOR DELETE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'worker'::public.user_role_enum) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false)))) AND (EXISTS ( SELECT 1
   FROM (public.entity_tags et
     JOIN public.tags t ON ((t.id = et.tag_id)))
  WHERE ((et.entity_type = 'expense'::text) AND (et.entity_id = expenses.id) AND (t.kind = 'vehicle'::text))))));


--
-- Name: expenses expenses_worker_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expenses_worker_select_own ON public.expenses FOR SELECT USING ((recorded_by = ( SELECT auth.uid() AS uid)));


--
-- Name: expenses expenses_worker_select_vehicle_tagged; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expenses_worker_select_vehicle_tagged ON public.expenses FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'worker'::public.user_role_enum) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false)))) AND (EXISTS ( SELECT 1
   FROM (public.entity_tags et
     JOIN public.tags t ON ((t.id = et.tag_id)))
  WHERE ((et.entity_type = 'expense'::text) AND (et.entity_id = expenses.id) AND (t.kind = 'vehicle'::text))))));


--
-- Name: expenses expenses_worker_update_vehicle_tagged; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expenses_worker_update_vehicle_tagged ON public.expenses FOR UPDATE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'worker'::public.user_role_enum) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false)))) AND (EXISTS ( SELECT 1
   FROM (public.entity_tags et
     JOIN public.tags t ON ((t.id = et.tag_id)))
  WHERE ((et.entity_type = 'expense'::text) AND (et.entity_id = expenses.id) AND (t.kind = 'vehicle'::text)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'worker'::public.user_role_enum) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false)))) AND (EXISTS ( SELECT 1
   FROM (public.entity_tags et
     JOIN public.tags t ON ((t.id = et.tag_id)))
  WHERE ((et.entity_type = 'expense'::text) AND (et.entity_id = expenses.id) AND (t.kind = 'vehicle'::text))))));


--
-- Name: hourly_salary_overrides hourly_salary_overrides_admin_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hourly_salary_overrides_admin_full ON public.hourly_salary_overrides USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: hourly_salary_overrides hourly_salary_overrides_office_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hourly_salary_overrides_office_full ON public.hourly_salary_overrides USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: hourly_salary_overrides hourly_salary_overrides_view_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hourly_salary_overrides_view_own ON public.hourly_salary_overrides FOR SELECT TO authenticated USING ((user_id = public.current_app_user_id()));


--
-- Name: idempotency_keys idempotency_keys_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY idempotency_keys_delete_own ON public.idempotency_keys FOR DELETE USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: idempotency_keys idempotency_keys_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY idempotency_keys_insert_own ON public.idempotency_keys FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: idempotency_keys idempotency_keys_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY idempotency_keys_select_own ON public.idempotency_keys FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: idempotency_keys idempotency_keys_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY idempotency_keys_update_own ON public.idempotency_keys FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: inventory inventory_admin_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inventory_admin_full ON public.inventory USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: inventory_movements inventory_movements_admin_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inventory_movements_admin_full ON public.inventory_movements USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: inventory_movements inventory_movements_office_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inventory_movements_office_full ON public.inventory_movements USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: inventory inventory_office_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inventory_office_full ON public.inventory USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: lease_agreements lease_agreements_admin_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lease_agreements_admin_full ON public.lease_agreements USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: lease_agreements lease_agreements_office_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lease_agreements_office_full ON public.lease_agreements USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: audit_logs no_insert_update_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY no_insert_update_delete ON public.audit_logs USING (false);


--
-- Name: users office_can_view_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY office_can_view_users ON public.users FOR SELECT USING ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: tasks office_full_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY office_full_access ON public.tasks TO authenticated USING ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: order_items office_full_order_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY office_full_order_items ON public.order_items USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: orders office_full_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY office_full_orders ON public.orders USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: projects office_insert_projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY office_insert_projects ON public.projects FOR INSERT WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: projects office_update_projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY office_update_projects ON public.projects FOR UPDATE USING ((( SELECT public.current_user_role() AS current_user_role) = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: projects office_view_projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY office_view_projects ON public.projects FOR SELECT USING ((( SELECT public.current_user_role() AS current_user_role) = 'office'::public.user_role_enum));


--
-- Name: users only_admin_update_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY only_admin_update_users ON public.users FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: order_items order_items_worker_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_items_worker_select ON public.order_items FOR SELECT TO authenticated USING (((public.current_user_role() = 'worker'::public.user_role_enum) AND (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_items.order_id) AND public.order_status_is_open(o.status))))));


--
-- Name: order_items order_items_worker_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_items_worker_update ON public.order_items FOR UPDATE TO authenticated USING (((public.current_user_role() = 'worker'::public.user_role_enum) AND (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_items.order_id) AND public.order_status_is_open(o.status)))))) WITH CHECK (((public.current_user_role() = 'worker'::public.user_role_enum) AND (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE (o.id = order_items.order_id)))));


--
-- Name: orders orders_worker_select_open; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_worker_select_open ON public.orders FOR SELECT TO authenticated USING (((public.current_user_role() = 'worker'::public.user_role_enum) AND public.order_status_is_open(status)));


--
-- Name: orders orders_worker_update_open; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_worker_update_open ON public.orders FOR UPDATE TO authenticated USING (((public.current_user_role() = 'worker'::public.user_role_enum) AND public.order_status_is_open(status))) WITH CHECK (((public.current_user_role() = 'worker'::public.user_role_enum) AND (public.order_status_is_open(status) OR (status = ANY (ARRAY['delivered'::text, 'completed'::text, 'סופקה'::text, 'הושלמה'::text])))));


--
-- Name: notifications own notifications read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own notifications read" ON public.notifications FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: notifications own notifications update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "own notifications update" ON public.notifications FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: payments payments_office_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_office_full ON public.payments USING ((( SELECT public.current_user_role() AS current_user_role) = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: payments payments_worker_delete_vehicle_tagged; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_worker_delete_vehicle_tagged ON public.payments FOR DELETE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'worker'::public.user_role_enum) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false)))) AND (EXISTS ( SELECT 1
   FROM (public.entity_tags et
     JOIN public.tags t ON ((t.id = et.tag_id)))
  WHERE ((et.entity_type = 'payment'::text) AND (et.entity_id = payments.id) AND (t.kind = 'vehicle'::text))))));


--
-- Name: payments payments_worker_insert_order; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_worker_insert_order ON public.payments FOR INSERT TO authenticated WITH CHECK (((public.current_user_role() = 'worker'::public.user_role_enum) AND (order_id IS NOT NULL) AND public.order_is_worker_deliverable(order_id)));


--
-- Name: payments payments_worker_select_order; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_worker_select_order ON public.payments FOR SELECT TO authenticated USING (((( SELECT public.current_user_role() AS current_user_role) = 'worker'::public.user_role_enum) AND (order_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = payments.order_id) AND public.order_status_is_open(o.status))))));


--
-- Name: payments payments_worker_select_vehicle_tagged; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_worker_select_vehicle_tagged ON public.payments FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'worker'::public.user_role_enum) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false)))) AND (EXISTS ( SELECT 1
   FROM (public.entity_tags et
     JOIN public.tags t ON ((t.id = et.tag_id)))
  WHERE ((et.entity_type = 'payment'::text) AND (et.entity_id = payments.id) AND (t.kind = 'vehicle'::text))))));


--
-- Name: payroll_periods payroll_periods_admin_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_periods_admin_full ON public.payroll_periods USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: payroll_periods payroll_periods_office_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_periods_office_manage ON public.payroll_periods USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: payroll_periods payroll_periods_worker_view_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_periods_worker_view_own ON public.payroll_periods FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.payslips p
  WHERE ((p.payroll_period_id = payroll_periods.id) AND (p.user_id = public.current_app_user_id())))));


--
-- Name: payslip_items payslip_items_admin_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payslip_items_admin_full ON public.payslip_items USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: payslip_items payslip_items_office_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payslip_items_office_full ON public.payslip_items USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: payslip_items payslip_items_view_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payslip_items_view_own ON public.payslip_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.payslips p
  WHERE ((p.id = payslip_items.payslip_id) AND (p.user_id = public.current_app_user_id())))));


--
-- Name: payslip_items payslip_items_worker_add_own_bonus; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payslip_items_worker_add_own_bonus ON public.payslip_items FOR INSERT TO authenticated WITH CHECK (((user_id = public.current_app_user_id()) AND (created_by = public.current_app_user_id()) AND (item_type = 'bonus'::text) AND (amount > (0)::numeric) AND (payslip_id IS NULL)));


--
-- Name: payslip_items payslip_items_worker_delete_own_unattached; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payslip_items_worker_delete_own_unattached ON public.payslip_items FOR DELETE TO authenticated USING (((user_id = public.current_app_user_id()) AND (item_type = 'bonus'::text) AND (payslip_id IS NULL)));


--
-- Name: payslips payslips_admin_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payslips_admin_full ON public.payslips USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: payslips payslips_view_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payslips_view_own ON public.payslips FOR SELECT TO authenticated USING ((user_id = public.current_app_user_id()));


--
-- Name: phone_attendance_reports phone_attendance_worker_close; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY phone_attendance_worker_close ON public.phone_attendance_reports FOR UPDATE TO authenticated USING (((public.current_user_role() = 'worker'::public.user_role_enum) AND (status = 'open'::text) AND public.is_payroll_worker(user_id))) WITH CHECK (((public.current_user_role() = 'worker'::public.user_role_enum) AND public.is_payroll_worker(user_id) AND (((status = 'open'::text) AND (clock_out IS NULL)) OR ((status = 'pending_review'::text) AND (clock_out IS NOT NULL) AND (clock_out > clock_in)))));


--
-- Name: phone_attendance_reports phone_attendance_worker_close_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY phone_attendance_worker_close_own ON public.phone_attendance_reports FOR UPDATE TO authenticated USING (((user_id = public.current_app_user_id()) AND (status = 'open'::text) AND (source = 'app'::text))) WITH CHECK (((user_id = public.current_app_user_id()) AND (status = 'pending_review'::text) AND (source = 'app'::text)));


--
-- Name: phone_attendance_reports phone_attendance_worker_edit_pending_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY phone_attendance_worker_edit_pending_own ON public.phone_attendance_reports FOR UPDATE TO authenticated USING (((user_id = public.current_app_user_id()) AND (status = 'pending_review'::text))) WITH CHECK (((user_id = public.current_app_user_id()) AND (status = 'pending_review'::text)));


--
-- Name: phone_attendance_reports phone_attendance_worker_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY phone_attendance_worker_insert ON public.phone_attendance_reports FOR INSERT TO authenticated WITH CHECK (((public.current_user_role() = 'worker'::public.user_role_enum) AND public.is_payroll_worker(user_id) AND (reported_by = public.current_app_user_id()) AND (status = ANY (ARRAY['open'::text, 'pending_review'::text])) AND (source = 'app'::text) AND (((status = 'open'::text) AND (clock_out IS NULL)) OR ((status = 'pending_review'::text) AND (clock_out IS NOT NULL) AND (clock_out > clock_in)))));


--
-- Name: phone_attendance_reports phone_attendance_worker_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY phone_attendance_worker_insert_own ON public.phone_attendance_reports FOR INSERT TO authenticated WITH CHECK (((user_id = public.current_app_user_id()) AND (status = 'open'::text) AND (source = 'app'::text)));


--
-- Name: phone_attendance_reports phone_attendance_worker_select_open_coworkers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY phone_attendance_worker_select_open_coworkers ON public.phone_attendance_reports FOR SELECT TO authenticated USING (((public.current_user_role() = 'worker'::public.user_role_enum) AND (status = 'open'::text) AND public.is_payroll_worker(user_id)));


--
-- Name: phone_attendance_reports phone_attendance_worker_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY phone_attendance_worker_select_own ON public.phone_attendance_reports FOR SELECT TO authenticated USING ((user_id = public.current_app_user_id()));


--
-- Name: users policy users_can_insert_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "policy users_can_insert_self" ON public.users FOR INSERT WITH CHECK (((id = ( SELECT auth.uid() AS uid)) AND (email = (( SELECT auth.jwt() AS jwt) ->> 'email'::text))));


--
-- Name: product_categories product_categories_admin_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_categories_admin_full ON public.product_categories USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: product_categories product_categories_office_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_categories_office_full ON public.product_categories USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: products products_admin_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_admin_full ON public.products USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: products products_office_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_office_full ON public.products USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: product_categories products_worker_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_worker_select ON public.product_categories FOR SELECT USING ((public.current_user_role() = 'worker'::public.user_role_enum));


--
-- Name: products products_worker_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_worker_select ON public.products FOR SELECT USING ((public.current_user_role() = 'worker'::public.user_role_enum));


--
-- Name: project_expenses project_expenses_office_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY project_expenses_office_full ON public.project_expenses USING ((( SELECT public.current_user_role() AS current_user_role) = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: projects projects_worker_view_own_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_worker_view_own_sessions ON public.projects FOR SELECT TO authenticated USING (((( SELECT public.current_user_role() AS current_user_role) = 'worker'::public.user_role_enum) AND (EXISTS ( SELECT 1
   FROM public.attendance_sessions s
  WHERE ((s.project_id = projects.id) AND (s.user_id = ( SELECT public.current_app_user_id() AS current_app_user_id)))))));


--
-- Name: properties properties_admin_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY properties_admin_full ON public.properties USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: properties properties_office_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY properties_office_full ON public.properties USING ((public.current_user_role() = 'office'::public.user_role_enum)) WITH CHECK ((public.current_user_role() = 'office'::public.user_role_enum));


--
-- Name: properties properties_worker_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY properties_worker_read ON public.properties FOR SELECT USING ((public.current_user_role() = 'worker'::public.user_role_enum));


--
-- Name: push_alert_config push_alert_config_admin_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_alert_config_admin_full ON public.push_alert_config USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: reminders reminders_self_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reminders_self_insert ON public.reminders FOR INSERT TO authenticated WITH CHECK ((created_by = public.task_current_user_id()));


--
-- Name: reminders reminders_self_or_task_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reminders_self_or_task_select ON public.reminders FOR SELECT TO authenticated USING (((created_by = public.task_current_user_id()) OR ((task_id IS NOT NULL) AND public.task_can_access(task_id))));


--
-- Name: reminders reminders_self_or_task_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reminders_self_or_task_update ON public.reminders FOR UPDATE TO authenticated USING (((created_by = public.task_current_user_id()) OR ((task_id IS NOT NULL) AND public.task_can_access(task_id))));


--
-- Name: salary_agreements salary_admin_full; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY salary_admin_full ON public.salary_agreements USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: salary_agreements salary_view_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY salary_view_own ON public.salary_agreements FOR SELECT TO authenticated USING ((user_id = public.current_app_user_id()));


--
-- Name: task_comments task_comments_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_comments_delete ON public.task_comments FOR DELETE TO authenticated USING (((author_id = public.task_current_user_id()) OR public.task_is_office_admin()));


--
-- Name: task_comments task_comments_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_comments_insert ON public.task_comments FOR INSERT TO authenticated WITH CHECK ((public.task_can_access(task_id) AND (author_id = public.task_current_user_id())));


--
-- Name: task_comments task_comments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_comments_select ON public.task_comments FOR SELECT TO authenticated USING (public.task_can_access(task_id));


--
-- Name: task_comments task_comments_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_comments_update ON public.task_comments FOR UPDATE TO authenticated USING (((author_id = public.task_current_user_id()) OR public.task_is_office_admin()));


--
-- Name: task_members task_members_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_members_delete ON public.task_members FOR DELETE TO authenticated USING (public.task_can_manage(task_id));


--
-- Name: task_members task_members_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_members_insert ON public.task_members FOR INSERT TO authenticated WITH CHECK (public.task_can_manage(task_id));


--
-- Name: task_members task_members_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_members_select ON public.task_members FOR SELECT TO authenticated USING (((user_id = public.task_current_user_id()) OR public.task_can_access(task_id)));


--
-- Name: tasks tasks_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_insert_authenticated ON public.tasks FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: tasks tasks_privacy_restrict; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_privacy_restrict ON public.tasks AS RESTRICTIVE TO authenticated USING (((COALESCE(is_private, false) = false) OR (private_owner_id = public.task_current_user_id()))) WITH CHECK (((COALESCE(is_private, false) = false) OR (private_owner_id = public.task_current_user_id())));


--
-- Name: tasks tasks_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_select_authenticated ON public.tasks FOR SELECT TO authenticated USING (true);


--
-- Name: tasks tasks_worker_delete_vehicle_tagged; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_worker_delete_vehicle_tagged ON public.tasks FOR DELETE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'worker'::public.user_role_enum) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false)))) AND (EXISTS ( SELECT 1
   FROM (public.entity_tags et
     JOIN public.tags t ON ((t.id = et.tag_id)))
  WHERE ((et.entity_type = 'task'::text) AND (et.entity_id = tasks.id) AND (t.kind = 'vehicle'::text))))));


--
-- Name: tasks tasks_worker_update_vehicle_tagged; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_worker_update_vehicle_tagged ON public.tasks FOR UPDATE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'worker'::public.user_role_enum) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false)))) AND (EXISTS ( SELECT 1
   FROM (public.entity_tags et
     JOIN public.tags t ON ((t.id = et.tag_id)))
  WHERE ((et.entity_type = 'task'::text) AND (et.entity_id = tasks.id) AND (t.kind = 'vehicle'::text)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = 'worker'::public.user_role_enum) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false)))) AND (EXISTS ( SELECT 1
   FROM (public.entity_tags et
     JOIN public.tags t ON ((t.id = et.tag_id)))
  WHERE ((et.entity_type = 'task'::text) AND (et.entity_id = tasks.id) AND (t.kind = 'vehicle'::text))))));


--
-- Name: user_sessions user_sessions_staff_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_sessions_staff_read ON public.user_sessions FOR SELECT TO authenticated USING ((public.is_admin() OR (public.current_user_role() = 'office'::public.user_role_enum)));


--
-- Name: users users_can_view_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_can_view_self ON public.users FOR SELECT USING ((auth_user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: users users_view_self_by_auth_id; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_view_self_by_auth_id ON public.users FOR SELECT TO authenticated USING ((auth_user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: users users_worker_view_coworkers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_worker_view_coworkers ON public.users FOR SELECT TO authenticated USING (((public.current_user_role() = 'worker'::public.user_role_enum) AND (active = true) AND (role = ANY (ARRAY['worker'::public.user_role_enum, 'worker_no_access'::public.user_role_enum]))));


--
-- Name: vehicle_mileage_readings vehicle_mileage_readings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vehicle_mileage_readings_delete ON public.vehicle_mileage_readings FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND ((u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) OR ((u.role = 'worker'::public.user_role_enum) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false)))))));


--
-- Name: vehicle_mileage_readings vehicle_mileage_readings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vehicle_mileage_readings_insert ON public.vehicle_mileage_readings FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.active = true) AND (COALESCE(u.system_access, false) = true) AND ((u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) OR ((u.role = 'worker'::public.user_role_enum) AND COALESCE(((u.section_access ->> 'vehicles'::text))::boolean, false)))))));


--
-- Name: vehicle_mileage_readings vehicle_mileage_readings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vehicle_mileage_readings_select ON public.vehicle_mileage_readings FOR SELECT TO authenticated USING (true);


--
-- Name: worker_absences worker_absences_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_absences_select_own ON public.worker_absences FOR SELECT TO authenticated USING ((user_id = public.current_app_user_id()));


--
-- Name: worker_absences worker_absences_staff_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_absences_staff_manage ON public.worker_absences TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.auth_user_id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['admin'::public.user_role_enum, 'office'::public.user_role_enum])) AND (u.active = true) AND (COALESCE(u.system_access, false) = true)))));


--
-- Name: expenses worker_insert_expenses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_insert_expenses ON public.expenses FOR INSERT WITH CHECK ((recorded_by = ( SELECT auth.uid() AS uid)));


--
-- Name: payments worker_insert_payment; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_insert_payment ON public.payments FOR INSERT WITH CHECK ((public.current_user_role() = 'worker'::public.user_role_enum));


--
-- Name: project_expenses worker_insert_project_expenses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_insert_project_expenses ON public.project_expenses FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.project_id = project_expenses.project_id) AND (t.assigned_user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: worker_payment_allocations worker_payment_allocations_view_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_payment_allocations_view_own ON public.worker_payment_allocations FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.worker_payments wp
  WHERE ((wp.id = worker_payment_allocations.worker_payment_id) AND (wp.user_id = public.current_app_user_id())))));


--
-- Name: worker_payments worker_payments_view_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_payments_view_own ON public.worker_payments FOR SELECT TO authenticated USING ((user_id = public.current_app_user_id()));


--
-- Name: expenses worker_update_own_expenses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_update_own_expenses ON public.expenses FOR UPDATE USING ((recorded_by = ( SELECT auth.uid() AS uid)));


--
-- Name: tasks worker_update_own_tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_update_own_tasks ON public.tasks FOR UPDATE USING ((assigned_user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: projects worker_view_assigned_projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_view_assigned_projects ON public.projects FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.tasks t
  WHERE ((t.project_id = projects.id) AND (t.assigned_user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: tasks worker_view_assigned_tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_view_assigned_tasks ON public.tasks FOR SELECT USING ((assigned_user_id = ( SELECT auth.uid() AS uid)));


--
-- PostgreSQL database dump complete
--

-- ===== grants =====
grant delete, insert, references, select, trigger, truncate, update on all tables in schema public to anon, authenticated, service_role;

-- product_order_stats() deliberately excludes anon (see
-- db/sql/fix_products_popularity_global.sql) -- global order-popularity
-- counts aren't meant for unauthenticated access. Every other function's
-- EXECUTE grant to anon/authenticated/service_role is Postgres's own
-- default for newly created functions, so nothing else needs granting here.
revoke execute on function public.product_order_stats() from anon;
