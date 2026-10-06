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

/** TEMPORARY: the connection check's live test row. */
const powersync_probe = new Table({ note: text, created_at: text });

export const AppSchema = new Schema({
  users,
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
  properties,
  lease_agreements,
  powersync_probe,
});

export type LocalDatabase = (typeof AppSchema)["types"];
