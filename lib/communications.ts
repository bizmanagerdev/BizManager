import type { SupabaseClient } from "@supabase/supabase-js";

// Communication logs (תיעוד פניות) + reminders (תזכורות) for the גבייה center.
// See db/sql/create_communication_center.sql.

export type CommunicationLog = {
  id: string;
  customer_id: string | null;
  user_id: string | null;
  channel: string;
  direction: string;
  content: string | null;
  category: string;
  order_id: string | null;
  project_id: string | null;
  property_id: string | null;
  payment_id: string | null;
  created_by: string | null;
  created_at: string;
  created_by_name: string | null;
};

export type Reminder = {
  id: string;
  customer_id: string | null;
  project_id: string | null;
  assigned_to: string | null;
  remind_at: string;
  content: string | null;
  action_type: string;
  status: string;
  category: string;
  order_id: string | null;
  property_id: string | null;
  payment_id: string | null;
  communication_log_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  assigned_to_name: string | null;
  customer_name: string | null;
  customer_phone: string | null;
};

export type CustomerActivity = {
  logs: CommunicationLog[];
  reminders: Reminder[];
};

// ─── Label helpers (Hebrew) ─────────────────────────────────────────────────────

export const COMMUNICATION_CHANNELS = [
  { value: "phone", label: "טלפון" },
  { value: "whatsapp", label: "וואטסאפ" },
  { value: "email", label: "מייל" },
  { value: "sms", label: "SMS" },
  { value: "meeting", label: "פגישה" },
  { value: "other", label: "אחר" },
] as const;

export const REMINDER_ACTION_TYPES = [
  { value: "call", label: "שיחה" },
  { value: "whatsapp", label: "וואטסאפ" },
  { value: "email", label: "מייל" },
  { value: "other", label: "אחר" },
] as const;

export function channelLabel(value: string | null | undefined) {
  return COMMUNICATION_CHANNELS.find((c) => c.value === value)?.label ?? value ?? "—";
}

export function directionLabel(value: string | null | undefined) {
  return value === "incoming" ? "נכנסת" : "יוצאת";
}

export function actionTypeLabel(value: string | null | undefined) {
  return REMINDER_ACTION_TYPES.find((a) => a.value === value)?.label ?? value ?? "—";
}

export function reminderStatusLabel(value: string | null | undefined) {
  switch (value) {
    case "done":
      return "בוצע";
    case "cancelled":
      return "בוטל";
    default:
      return "ממתין";
  }
}

type Row = Record<string, unknown>;

function str(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v : null;
}

async function resolveUserNames(supabase: SupabaseClient, ids: string[]) {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data } = await supabase.from("users").select("id,full_name,email").in("id", unique);
  for (const row of (data ?? []) as Row[]) {
    const id = str(row, "id");
    if (!id) continue;
    map.set(id, str(row, "full_name") ?? str(row, "email") ?? id.slice(0, 8));
  }
  return map;
}

const LOG_SELECT =
  "id,customer_id,user_id,channel,direction,content,category,order_id,project_id,property_id,payment_id,created_by,created_at";
const REMINDER_SELECT =
  "id,customer_id,project_id,assigned_to,remind_at,content,action_type,status,category,order_id,property_id,payment_id,communication_log_id,created_by,created_at,updated_at";

/** Logs + reminders for a single customer (newest first). Used by the tracking panel. */
export async function getCustomerActivity(
  supabase: SupabaseClient,
  customerId: string
): Promise<CustomerActivity> {
  const [logsRes, remindersRes] = await Promise.all([
    supabase
      .from("communication_logs")
      .select(LOG_SELECT)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .range(0, 199),
    supabase
      .from("reminders")
      .select(REMINDER_SELECT)
      .eq("customer_id", customerId)
      .order("remind_at", { ascending: true })
      .range(0, 199),
  ]);

  const logRows = (logsRes.data ?? []) as Row[];
  const reminderRows = (remindersRes.data ?? []) as Row[];

  const nameIds = [
    ...logRows.map((r) => str(r, "created_by") ?? str(r, "user_id")),
    ...reminderRows.map((r) => str(r, "assigned_to")),
  ].filter((v): v is string => Boolean(v));
  const names = await resolveUserNames(supabase, nameIds);

  const logs: CommunicationLog[] = logRows.map((r) => ({
    id: str(r, "id") ?? "",
    customer_id: str(r, "customer_id"),
    user_id: str(r, "user_id"),
    channel: str(r, "channel") ?? "phone",
    direction: str(r, "direction") ?? "outgoing",
    content: str(r, "content"),
    category: str(r, "category") ?? "collection",
    order_id: str(r, "order_id"),
    project_id: str(r, "project_id"),
    property_id: str(r, "property_id"),
    payment_id: str(r, "payment_id"),
    created_by: str(r, "created_by"),
    created_at: str(r, "created_at") ?? "",
    created_by_name:
      names.get(str(r, "created_by") ?? "") ?? names.get(str(r, "user_id") ?? "") ?? null,
  }));

  const reminders: Reminder[] = reminderRows.map((r) => ({
    id: str(r, "id") ?? "",
    customer_id: str(r, "customer_id"),
    project_id: str(r, "project_id"),
    assigned_to: str(r, "assigned_to"),
    remind_at: str(r, "remind_at") ?? "",
    content: str(r, "content"),
    action_type: str(r, "action_type") ?? "call",
    status: str(r, "status") ?? "pending",
    category: str(r, "category") ?? "collection",
    order_id: str(r, "order_id"),
    property_id: str(r, "property_id"),
    payment_id: str(r, "payment_id"),
    communication_log_id: str(r, "communication_log_id"),
    created_by: str(r, "created_by"),
    created_at: str(r, "created_at") ?? "",
    updated_at: str(r, "updated_at") ?? "",
    assigned_to_name: names.get(str(r, "assigned_to") ?? "") ?? null,
    customer_name: null,
    customer_phone: null,
  }));

  return { logs, reminders };
}

/** Open (pending) reminders across all customers, soonest first. Powers the תזכורות view. */
export async function getOpenReminders(
  supabase: SupabaseClient,
  options?: { limit?: number }
): Promise<Reminder[]> {
  const limit = options?.limit ?? 200;
  const { data, error } = await supabase
    .from("reminders")
    .select(REMINDER_SELECT)
    .eq("status", "pending")
    .order("remind_at", { ascending: true })
    .range(0, limit - 1);

  if (error || !data) return [];
  const rows = data as Row[];

  const customerIds = rows.map((r) => str(r, "customer_id")).filter((v): v is string => Boolean(v));
  const assigneeIds = rows.map((r) => str(r, "assigned_to")).filter((v): v is string => Boolean(v));

  const [names, customersRes] = await Promise.all([
    resolveUserNames(supabase, assigneeIds),
    customerIds.length > 0
      ? supabase.from("customers").select("id,name,phone").in("id", Array.from(new Set(customerIds)))
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  const customerById = new Map<string, { name: string | null; phone: string | null }>();
  for (const row of (customersRes.data ?? []) as Row[]) {
    const id = str(row, "id");
    if (id) customerById.set(id, { name: str(row, "name"), phone: str(row, "phone") });
  }

  return rows.map((r) => {
    const cust = customerById.get(str(r, "customer_id") ?? "");
    return {
      id: str(r, "id") ?? "",
      customer_id: str(r, "customer_id"),
      project_id: str(r, "project_id"),
      assigned_to: str(r, "assigned_to"),
      remind_at: str(r, "remind_at") ?? "",
      content: str(r, "content"),
      action_type: str(r, "action_type") ?? "call",
      status: str(r, "status") ?? "pending",
      category: str(r, "category") ?? "collection",
      order_id: str(r, "order_id"),
      property_id: str(r, "property_id"),
      payment_id: str(r, "payment_id"),
      communication_log_id: str(r, "communication_log_id"),
      created_by: str(r, "created_by"),
      created_at: str(r, "created_at") ?? "",
      updated_at: str(r, "updated_at") ?? "",
      assigned_to_name: names.get(str(r, "assigned_to") ?? "") ?? null,
      customer_name: cust?.name ?? null,
      customer_phone: cust?.phone ?? null,
    };
  });
}

export type CommunicationLogWithCustomer = CommunicationLog & {
  customer_name: string | null;
  customer_phone: string | null;
};

/** Recent communication logs across all customers (newest first) — powers the
 *  global "יומן שיחות" feed on the גבייה page. */
export async function getRecentCommunications(
  supabase: SupabaseClient,
  options?: { limit?: number }
): Promise<CommunicationLogWithCustomer[]> {
  const limit = options?.limit ?? 60;
  const { data, error } = await supabase
    .from("communication_logs")
    .select(LOG_SELECT)
    .order("created_at", { ascending: false })
    .range(0, limit - 1);

  if (error || !data) return [];
  const rows = data as Row[];

  const userIds = rows
    .map((r) => str(r, "created_by") ?? str(r, "user_id"))
    .filter((v): v is string => Boolean(v));
  const customerIds = rows
    .map((r) => str(r, "customer_id"))
    .filter((v): v is string => Boolean(v));

  const [names, customersRes] = await Promise.all([
    resolveUserNames(supabase, userIds),
    customerIds.length > 0
      ? supabase.from("customers").select("id,name,phone").in("id", Array.from(new Set(customerIds)))
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  const customerById = new Map<string, { name: string | null; phone: string | null }>();
  for (const row of (customersRes.data ?? []) as Row[]) {
    const id = str(row, "id");
    if (id) customerById.set(id, { name: str(row, "name"), phone: str(row, "phone") });
  }

  return rows.map((r) => {
    const cust = customerById.get(str(r, "customer_id") ?? "");
    return {
      id: str(r, "id") ?? "",
      customer_id: str(r, "customer_id"),
      user_id: str(r, "user_id"),
      channel: str(r, "channel") ?? "phone",
      direction: str(r, "direction") ?? "outgoing",
      content: str(r, "content"),
      category: str(r, "category") ?? "collection",
      order_id: str(r, "order_id"),
      project_id: str(r, "project_id"),
      property_id: str(r, "property_id"),
      payment_id: str(r, "payment_id"),
      created_by: str(r, "created_by"),
      created_at: str(r, "created_at") ?? "",
      created_by_name:
        names.get(str(r, "created_by") ?? "") ?? names.get(str(r, "user_id") ?? "") ?? null,
      customer_name: cust?.name ?? null,
      customer_phone: cust?.phone ?? null,
    };
  });
}

/**
 * Per-customer last-contact + next-open-reminder, to enrich the גבייה worklist.
 * Returns a map keyed by customer_id.
 */
export async function getCollectionActivityByCustomer(
  supabase: SupabaseClient,
  customerIds: string[]
): Promise<Map<string, { lastContactAt: string | null; nextReminderAt: string | null }>> {
  const result = new Map<string, { lastContactAt: string | null; nextReminderAt: string | null }>();
  const unique = Array.from(new Set(customerIds.filter(Boolean)));
  if (unique.length === 0) return result;

  const [logsRes, remindersRes] = await Promise.all([
    supabase
      .from("communication_logs")
      .select("customer_id,created_at")
      .in("customer_id", unique)
      .order("created_at", { ascending: false })
      .range(0, 999),
    supabase
      .from("reminders")
      .select("customer_id,remind_at,status")
      .in("customer_id", unique)
      .eq("status", "pending")
      .order("remind_at", { ascending: true })
      .range(0, 999),
  ]);

  for (const row of (logsRes.data ?? []) as Row[]) {
    const cid = str(row, "customer_id");
    const at = str(row, "created_at");
    if (!cid || !at) continue;
    const existing = result.get(cid) ?? { lastContactAt: null, nextReminderAt: null };
    if (!existing.lastContactAt || at > existing.lastContactAt) existing.lastContactAt = at;
    result.set(cid, existing);
  }
  for (const row of (remindersRes.data ?? []) as Row[]) {
    const cid = str(row, "customer_id");
    const at = str(row, "remind_at");
    if (!cid || !at) continue;
    const existing = result.get(cid) ?? { lastContactAt: null, nextReminderAt: null };
    if (!existing.nextReminderAt || at < existing.nextReminderAt) existing.nextReminderAt = at;
    result.set(cid, existing);
  }

  return result;
}
