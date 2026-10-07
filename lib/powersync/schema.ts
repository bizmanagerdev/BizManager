import { column, Schema, Table } from "@powersync/web";

// The on-device tables, one per synced table in powersync/sync-config.yaml,
// with the same columns. `id` is implicit (PowerSync adds it). Types follow
// how PowerSync delivers Postgres values: booleans arrive as 1/0 (integer),
// numeric/money and every date/time as TEXT (never add money up as floats),
// json/jsonb and arrays as JSON text, enums and uuids as text.
//
// A column here that the stream doesn't send just reads as null; a column the
// stream sends that isn't listed here is kept but invisible to queries — so
// when a synced table gains a column, add it in both places.

const text = column.text;
const int = column.integer;
const real = column.real;

/** People: names and colours (staff stream "people"). */
const users = new Table(
  {
    full_name: text,
    email: text,
    phone: text,
    avatar_color: text,
    role: text,
    active: int,
    system_access: int,
    locale: text,
    notification_prefs: text,
    pay_tracking_mode: text,
    payroll_worker_type: text,
    /** The login id (some rows record who entered them by it). Staff copies only, from sync rules v1.7. */
    auth_user_id: text,
  },
  { indexes: { by_role: ["role"] } }
);

const tasks = new Table(
  {
    subject: text,
    description: text,
    status: text,
    priority: text,
    due_date: text,
    assigned_user_id: text,
    project_id: text,
    notes: text,
    created_at: text,
    updated_at: text,
    business_domain: text,
    property_id: text,
    recurring_task_template_id: text,
    recurrence_key: text,
    due_time: text,
    city: text,
    address: text,
    is_private: int,
    private_owner_id: text,
    customer_id: text,
    subject_he: text,
    description_he: text,
    subject_ar: text,
    description_ar: text,
    sort_order: real,
    completed_at: text,
    // Local only — never sent down by the server, so a sync clears it: what
    // goes up with a change made on the device that isn't a column of the row
    // (its members, tags, the reminders set while creating it). See
    // lib/powersync/local-writes.ts.
    _extras: text,
  },
  { indexes: { by_assignee: ["assigned_user_id"], by_status: ["status"], by_project: ["project_id"] } }
);

/** id = "<task_id>:<user_id>" (the table's key is the pair). */
const task_members = new Table(
  { task_id: text, user_id: text, created_at: text },
  { indexes: { by_task: ["task_id"], by_user: ["user_id"] } }
);

const reminders = new Table(
  {
    customer_id: text,
    project_id: text,
    property_id: text,
    order_id: text,
    reminder_user_id: text,
    reminder_at: text,
    content: text,
    action_type: text,
    status: text,
    created_by: text,
    updated_by: text,
    created_at: text,
    updated_at: text,
    assigned_to: text,
    remind_at: text,
    category: text,
    payment_id: text,
    communication_log_id: text,
    task_id: text,
    notified_at: text,
    source: text,
    dedupe_key: text,
    title: text,
    url: text,
    severity: text,
    behavior: text,
    audience_role: text,
    snoozed_until: text,
    snoozed_by: text,
    next_ping_at: text,
    ping_count: int,
    max_pings: int,
    repeat_rule: text,
    resolved_at: text,
    invoice_id: text,
    vehicle_id: text,
    expense_id: text,
  },
  { indexes: { by_assignee: ["assigned_to"], by_task: ["task_id"], by_remind_at: ["remind_at"] } }
);

const projects = new Table(
  {
    customer_id: text,
    name: text,
    project_type: text,
    status: text,
    agreed_base_price: text,
    actual_price: text,
    expenses_billed_separately: int,
    project_manager_id: text,
    start_date: text,
    end_date: text,
    notes: text,
    created_at: text,
    updated_at: text,
    items_to_move: text,
    payment_terms: text,
    due_date: text,
    price_includes_vat: int,
    vat_rate: text,
    no_charge: int,
    origin_address: text,
    origin_floor: text,
    origin_has_elevator: int,
    destination_address: text,
    destination_floor: text,
    destination_has_elevator: int,
    branch_id: text,
    completed_at: text,
  },
  { indexes: { by_customer: ["customer_id"], by_manager: ["project_manager_id"] } }
);

const orders = new Table(
  {
    customer_id: text,
    order_date: text,
    status: text,
    subtotal: text,
    discount_amount: text,
    total_amount: text,
    payment_status: text,
    created_by: text,
    notes: text,
    created_at: text,
    updated_at: text,
    payment_terms: text,
    due_date: text,
    needs_invoice: int,
    invoice_sent_at: text,
    delivery_confirmed_at: text,
    collect_payment_on_delivery: int,
    requested_delivery_date: text,
    branch_id: text,
    closed_at: text,
  },
  { indexes: { by_customer: ["customer_id"], by_status: ["status"] } }
);

/** id = "<order_id>:<user_id>" (the table's key is the pair). */
const order_delivery_recipients = new Table(
  { order_id: text, user_id: text, created_at: text },
  { indexes: { by_order: ["order_id"], by_user: ["user_id"] } }
);

const customers = new Table(
  {
    name: text,
    name_for_invoice: text,
    registration_number: text,
    phone: text,
    email: text,
    address: text,
    active: int,
    notes: text,
    created_at: text,
    updated_at: text,
    whatsapp: text,
    morning_client_id: text,
    morning_synced_at: text,
    morning_match_status: text,
    morning_last_sync_error: text,
    requires_prepayment: int,
    city: text,
    delivery_instructions: text,
    delivery_lat: text,
    delivery_lng: text,
    linked_user_id: text,
  },
  { indexes: { by_name: ["name"] } }
);

const customer_branches = new Table(
  {
    customer_id: text,
    name: text,
    address: text,
    phone: text,
    active: int,
    created_at: text,
    updated_at: text,
  },
  { indexes: { by_customer: ["customer_id"] } }
);

const order_items = new Table(
  {
    order_id: text,
    product_id: text,
    quantity_ordered: text,
    quantity_delivered: text,
    unit_price: text,
    discount_amount: text,
    line_total: text,
    notes: text,
    description: text,
  },
  { indexes: { by_order: ["order_id"] } }
);

const products = new Table({
  sku: text,
  barcode: text,
  name: text,
  category_id: text,
  description: text,
  base_price: text,
  base_cost: text,
  active: int,
  created_at: text,
  updated_at: text,
  low_stock_threshold: text,
});

/** id = product_id (the table's key). */
const inventory = new Table({
  product_id: text,
  quantity_on_hand: text,
  quantity_reserved: text,
  updated_at: text,
});

const payments = new Table(
  {
    payment_date: text,
    amount_total: text,
    payment_method: text,
    reference_number: text,
    amount_including_vat: text,
    amount_before_vat: text,
    net_amount: text,
    recorded_by: text,
    notes: text,
    created_at: text,
    updated_at: text,
    payment_status: text,
    business_domain: text,
    project_id: text,
    order_id: text,
    property_id: text,
    due_date: text,
    requires_split: int,
    check_number: text,
    vat_rate: text,
    vat_amount: text,
    account_id: text,
    cleared_at: text,
  },
  { indexes: { by_order: ["order_id"], by_project: ["project_id"], by_due: ["due_date"] } }
);

const phone_attendance_reports = new Table(
  {
    user_id: text,
    clock_in: text,
    clock_out: text,
    worked_minutes: int,
    status: text,
    source: text,
    provider_call_id: text,
    attendance_session_id: text,
    reviewed_by: text,
    reviewed_at: text,
    notes: text,
    created_at: text,
    updated_at: text,
    reported_by: text,
    replaces_session_id: text,
    notes_he: text,
  },
  { indexes: { by_user: ["user_id"], by_status: ["status"] } }
);

const attendance_sessions = new Table(
  {
    user_id: text,
    clock_in: text,
    clock_out: text,
    worked_minutes: int,
    notes: text,
    business_domain: text,
    project_id: text,
    property_id: text,
    labor_cost: text,
    is_billable_to_customer: int,
    bill_to_customer_amount: text,
    billing_status: text,
    notes_he: text,
  },
  { indexes: { by_user: ["user_id"], by_clock_in: ["clock_in"] } }
);

const properties = new Table({
  address: text,
  asset_description: text,
  is_active: int,
  created_at: text,
  updated_at: text,
  name: text,
  rooms: text,
  square_meters: text,
  floor: int,
  bathrooms: int,
  has_private_entrance: int,
  has_storage_room: int,
  has_parking: int,
  has_elevator: int,
  purchased_from: text,
  purchase_date: text,
  purchase_price: text,
  purchase_tax: text,
  land_block: text,
  land_parcel: text,
  land_sub_parcel: text,
  is_furnished: int,
  furniture_items: text,
  property_type: text,
  apartments_count: int,
  mezuzah_count: int,
  light_bulb_count: int,
  electricity_contract_number: text,
  water_contract_number: text,
  gas_contract_number: text,
  arnona_contract_number: text,
  key_count: int,
});

const lease_agreements = new Table(
  {
    property_id: text,
    customer_id: text,
    start_date: text,
    end_date: text,
    monthly_rent_amount: text,
    document_id: text,
    status: text,
    notes: text,
    created_at: text,
    updated_at: text,
    deposit_type: text,
    deposit_amount: text,
    deposit_reference: text,
    keys_handed_over: int,
    rent_day_of_month: int,
  },
  { indexes: { by_property: ["property_id"] } }
);

// The money behind each project (project_financials_view, worker_debt_items_view
// — worked out on the device by lib/powersync/local-supabase.ts).

const expenses = new Table(
  {
    expense_date: text,
    amount: text,
    category: text,
    description: text,
    business_domain: text,
    notes: text,
    recorded_by: text,
    created_at: text,
    updated_at: text,
    project_id: text,
    order_id: text,
    property_id: text,
    recurring_expense_template_id: text,
    recurrence_key: text,
    payment_status: text,
    paid_amount: text,
    payment_method: text,
    transaction_date: text,
    account_id: text,
    paid_date: text,
    installment_group_id: text,
    installment_index: int,
    installment_count: int,
  },
  { indexes: { by_project: ["project_id"], by_date: ["expense_date"] } }
);

const project_expenses = new Table(
  {
    project_id: text,
    expense_id: text,
    included_in_base_price: int,
    billed_to_customer: int,
    notes: text,
  },
  { indexes: { by_project: ["project_id"], by_expense: ["expense_id"] } }
);

const payslips = new Table(
  {
    payroll_period_id: text,
    user_id: text,
    calculated_salary_type: text,
    total_work_minutes: int,
    calculated_base_salary: text,
    manual_adjustments: text,
    gross_salary: text,
    notes: text,
  },
  { indexes: { by_user: ["user_id"], by_period: ["payroll_period_id"] } }
);

const payroll_periods = new Table({
  period_month: text,
  start_date: text,
  end_date: text,
  status: text,
});

const salary_agreements = new Table(
  {
    user_id: text,
    salary_type: text,
    hourly_rate: text,
    monthly_salary: text,
    valid_from: text,
    valid_to: text,
    notes: text,
    overtime_rate: text,
    standard_daily_hours: text,
    due_day_of_next_month: int,
    business_domain: text,
    project_id: text,
    property_id: text,
    is_billable_to_customer: int,
    bill_to_customer_amount: text,
  },
  { indexes: { by_user: ["user_id"] } }
);

const worker_payments = new Table(
  {
    user_id: text,
    payment_date: text,
    amount: text,
    payment_method: text,
    reference_number: text,
    notes: text,
    recorded_by: text,
    created_at: text,
    account_id: text,
  },
  { indexes: { by_user: ["user_id"] } }
);

const worker_payment_allocations = new Table(
  {
    worker_payment_id: text,
    source_type: text,
    attendance_session_id: text,
    payslip_id: text,
    amount: text,
    created_at: text,
  },
  { indexes: { by_payment: ["worker_payment_id"] } }
);

// Stock movements and product categories (the sales tabs: price list, stock).

const inventory_movements = new Table(
  {
    product_id: text,
    movement_type: text,
    quantity: text,
    source_type: text,
    source_id: text,
    performed_by: text,
    notes: text,
    created_at: text,
  },
  { indexes: { by_product: ["product_id"], by_created: ["created_at"] } }
);

const product_categories = new Table({ name: text, active: int });

// The tasks board's comment and file counts. task_comments arrive only for
// tasks the person may open (powersync/sync-config.yaml: not private, or their
// own private task).

const task_comments = new Table(
  { task_id: text, author_id: text, body: text, body_he: text, created_at: text, updated_at: text },
  { indexes: { by_task: ["task_id"] } }
);

/** A document linked to a task, order, project… (entity_type + entity_id). */
const document_links = new Table(
  { document_id: text, entity_type: text, entity_id: text, created_at: text },
  { indexes: { by_entity: ["entity_type", "entity_id"] } }
);

/**
 * Everyone's name and colour — exactly what user_directory() hands anyone.
 * Workers' copy only (stream worker_people): their `users` holds just their
 * own row, as on the server, so a loader reading `users` sees what it sees
 * there. Staff read everyone from `users`.
 */
const user_directory = new Table({ full_name: text, avatar_color: text, role: text, active: int });

/** Every property's name and address — exactly what property_directory() hands anyone (workers' copy only). */
const property_directory = new Table({ name: text, address: text, is_active: int });

// A project's page (sync rules v1.7, admins and office): each movement's
// account by name, the VAT rate, and a recurring bill's rule by name.
const accounts = new Table({ name: text });
/**
 * One row; id = "true" (the table's key is the boolean true). money_tables = 1:
 * this copy has the money cards' tables below (sync rules v1.8 — see
 * lib/powersync/money-copy.ts).
 */
const business_settings = new Table({ vat_rate: text, books_start_date: text, money_tables: int });
const recurring_expense_templates = new Table({
  template_name: text,
  created_by: text,
  category: text,
  amount: text,
  is_variable_amount: int,
  auto_paid: int,
  description_template: text,
  notes_template: text,
  business_domain: text,
  account_id: text,
  frequency: text,
  interval_months: int,
  expense_day_of_month: int,
  expense_month_of_year: int,
  start_date: text,
  end_date: text,
  created_at: text,
  is_active: int,
  reminder_work_days_before: int,
});

// The dashboard's money cards (sync rules v1.8): loans and their repayments,
// card statements (the charges, and of the statement lines only which expense
// each one is), card settlements already confirmed, the payment sources'
// settings.
const loans = new Table({
  direction: text,
  lender: text,
  borrower: text,
  loan_date: text,
  loan_method: text,
  repayment_method: text,
  documentation: text,
  amount: text,
  due_date: text,
  interest_amount: text,
  business_domain: text,
  counterparty_customer_id: text,
  status: text,
  notes: text,
  created_by: text,
  created_at: text,
  updated_at: text,
  account_id: text,
});
const loan_repayments = new Table(
  {
    loan_id: text,
    repayment_date: text,
    amount: text,
    interest_amount: text,
    method: text,
    notes: text,
    created_by: text,
    created_at: text,
    account_id: text,
    status: text,
    installment_index: int,
    installment_count: int,
  },
  { indexes: { by_loan: ["loan_id"] } }
);
const card_statement_charges = new Table({
  statement_id: text,
  card_label: text,
  account_id: text,
  amount: text,
  charge_date: text,
  notes: text,
});
const card_statement_rows = new Table(
  { expense_id: text, statement_id: text, card_label: text, category: text },
  { indexes: { by_expense: ["expense_id"] } }
);
const card_settlement_confirmations = new Table({ account_id: text, settlement_date: text });
const outflow_source_settings = new Table({
  source_kind: text,
  source_key: text,
  reminder_work_days_before: int,
  account_id: text,
  is_active: int,
});

export const AppSchema = new Schema({
  users,
  user_directory,
  property_directory,
  tasks,
  task_members,
  reminders,
  projects,
  orders,
  order_delivery_recipients,
  customers,
  customer_branches,
  order_items,
  products,
  inventory,
  payments,
  phone_attendance_reports,
  attendance_sessions,
  properties,
  lease_agreements,
  expenses,
  project_expenses,
  payslips,
  payroll_periods,
  salary_agreements,
  worker_payments,
  worker_payment_allocations,
  inventory_movements,
  product_categories,
  task_comments,
  document_links,
  accounts,
  business_settings,
  recurring_expense_templates,
  loans,
  loan_repayments,
  card_statement_charges,
  card_statement_rows,
  card_settlement_confirmations,
  outflow_source_settings,
});

export type LocalDatabase = (typeof AppSchema)["types"];
