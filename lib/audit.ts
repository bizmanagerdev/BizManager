import { toHebrewError } from "@/lib/error-messages";
import type { SupabaseClient } from "@supabase/supabase-js";

type AuditLogPrimitive = string | number | boolean | null;
type AuditLogValue = AuditLogPrimitive | AuditLogValue[] | { [key: string]: AuditLogValue };

export type AuditLogRow = {
  id: string;
  table_name: string;
  record_id: string;
  action: string;
  changed_by: string | null;
  user_role: string | null;
  created_at: string | null;
  new_data?: AuditLogValue;
  old_data?: AuditLogValue;
};

type AuditActorRow = {
  id: string;
  auth_user_id?: string | null;
  full_name: string | null;
  email: string | null;
  avatar_color?: string | null;
};

type LogAuditParams = {
  supabase: SupabaseClient;
  tableName: string;
  recordId: string;
  action: string;
  changedBy: string | null | undefined;
  userRole: string | null | undefined;
  oldData?: AuditLogValue;
  newData?: AuditLogValue;
};

// A single field change on an update row, kept structured so the table can show
// the old value and the new value in two separate columns.
export type AuditChange = { label: string; before: string; after: string };

export type AuditFeedItem = {
  id: string;
  tableName: string;
  recordId: string;
  action: string;
  actionLabel: string;
  entityLabel: string;
  summary: string;
  // Full human line (base info + "field: old → new" changes) — used by the mobile
  // cards and any single-string surface.
  details: string;
  // Just the base info (amount, description, session length…) WITHOUT the field
  // changes — the desktop table shows this in the item column, changes in their
  // own before/after columns.
  baseDetails: string;
  // Structured field changes (empty unless it's an update with tracked fields).
  changes: AuditChange[];
  actorName: string;
  actorRole: string | null;
  // The actor's chosen avatar color (users.avatar_color), so the feed avatar
  // matches the color they picked elsewhere. Null → InitialsAvatar falls back
  // to its name-hash palette.
  actorColor: string | null;
  createdAt: string | null;
  // Human identifier of the affected entity (customer/project/worker name),
  // resolved from foreign keys — so a row reads "הזמנה · ביאן מרקט" not just
  // "הזמנה". Null when nothing nameable could be resolved.
  title: string | null;
  // Deep link to the affected entity (or its parent), or null when the row has
  // no viewable target. e.g. an order_items row links to its order.
  href: string | null;
  // Grouping key of the parent business entity (e.g. "order:<uuid>"), used to
  // collapse side-effect rows under the action that caused them. Null = stands
  // on its own.
  parentKey: string | null;
  // True for low-level side-effect rows (order_items, inventory movements,
  // document links, payment allocations) that should fold under their parent.
  isChild: boolean;
};

// A header row plus the side-effect rows that collapse beneath it.
export type AuditGroup = { header: AuditFeedItem; children: AuditFeedItem[] };

export type AuditRecordInfo = {
  action: string;
  actionLabel: string;
  entityLabel: string;
  summary: string;
  details: string;
  actorName: string;
  actorRole: string | null;
  createdAt: string | null;
};

export function entityLabel(tableName: string) {
  switch (tableName) {
    case "projects": return "פרויקט";
    case "tasks": return "משימה";
    case "expenses": return "הוצאה";
    case "payments": return "תשלום";
    case "documents": return "מסמך";
    case "customers": return "לקוח";
    case "orders": return "הזמנה";
    case "properties": return "נכס";
    case "users": return "משתמש";
    case "attendance_sessions": return "שעות עבודה";
    case "worker_payments": return "תשלום לעובד";
    case "salary_agreements": return "הסכם שכר";
    case "payroll_periods": return "תקופת שכר";
    case "payslips": return "תלוש שכר";
    case "products": return "מוצר";
    case "product_categories": return "קטגוריית מוצר";
    case "inventory_movements": return "תנועת מלאי";
    case "vehicles": return "רכב";
    case "tags": return "תגית";
    case "inquiries": return "פנייה";
    case "recurring_expense_templates": return "הוצאה קבועה";
    case "recurring_task_templates": return "משימה קבועה";
    case "communications": return "תקשורת";
    case "communication_logs": return "תקשורת";
    case "task_comments": return "תגובה";
    case "task_members": return "משתתף במשימה";
    case "task_time_reports": return "דיווח זמן";
    case "loans": return "הלוואה";
    case "loan_repayments": return "החזר הלוואה";
    case "accounts": return "חשבון";
    case "entity_tags": return "תיוג";
    case "card_statements": return "דף אשראי";
    case "expense_installments": return "תשלום הוצאה";
    case "push_alert_config": return "הגדרת התראה";
    case "contacts": return "איש קשר";
    case "document_links": return "קישור מסמך";
    case "fcm_tokens":
    case "push_subscriptions": return "מכשיר";
    case "morning_documents": return "מסמך Morning";
    case "morning_settings": return "הגדרות Morning";
    case "reminders": return "תזכורת";
    case "auth": return "מערכת";
    case "system": return "מערכת";
    default: return tableName;
  }
}

export function actionLabel(action: string) {
  switch (action) {
    case "login":
      return "התחבר";
    case "logout":
      return "התנתק";
    case "reminders_synced":
      return "רענון תזכורות";
    case "create":
    case "INSERT":
      return "נוצר";
    case "update":
    case "UPDATE":
      return "עודכן";
    case "delete":
    case "DELETE":
      return "נמחק";
    case "status_changed":
      return "סטטוס עודכן";
    case "priority_changed":
      return "עדיפות עודכנה";
    case "upload":
      return "הועלה";
    case "morning_customer_linked":
      return "קושר ל-Morning";
    case "morning_customer_synced":
      return "סונכרן עם Morning";
    case "morning_document_created":
      return "מסמך Morning נוצר";
    case "morning_document_synced":
      return "מסמך Morning סונכרן";
    case "morning_document_closed":
      return "מסמך Morning נסגר";
    case "morning_auto_invoice_failed":
      return "הנפקת חשבונית אוטומטית ב-Morning נכשלה";
    case "morning_auto_receipt_failed":
      return "הנפקת קבלה אוטומטית ב-Morning נכשלה";
    default:
      return action;
  }
}

export function buildDetails(tableName: string, newData: AuditLogValue): string {
  if (!newData || typeof newData !== "object" || Array.isArray(newData)) return "";
  const d = newData as Record<string, AuditLogValue>;

  const money = (val: AuditLogValue): string | null => {
    const n = Number(val);
    return Number.isFinite(n) && n > 0 ? `₪${n.toLocaleString("he-IL")}` : null;
  };
  const str = (val: AuditLogValue): string | null => {
    const s = typeof val === "string" ? val.trim() : "";
    return s || null;
  };

  const parts: string[] = [];

  switch (tableName) {
    case "payments":
    case "worker_payments": {
      const amt = money(d.amount);
      if (amt) parts.push(amt);
      const note = str(d.notes);
      if (note) parts.push(note);
      break;
    }
    case "expenses": {
      const amt = money(d.amount);
      if (amt) parts.push(amt);
      const desc = str(d.description);
      if (desc) parts.push(desc);
      break;
    }
    case "tasks": {
      const subj = str(d.subject) ?? str(d.title);
      if (subj) parts.push(subj);
      break;
    }
    case "projects": {
      const name = str(d.name);
      if (name) parts.push(name);
      break;
    }
    case "customers": {
      const name = str(d.full_name) ?? str(d.name);
      if (name) parts.push(name);
      const phone = str(d.phone);
      if (phone) parts.push(phone);
      break;
    }
    case "orders": {
      const amt = money(d.total_price) ?? money(d.total_amount);
      if (amt) parts.push(amt);
      break;
    }
    case "attendance_sessions": {
      const clockIn = str(d.clock_in);
      if (clockIn) {
        const date = new Date(clockIn);
        if (!Number.isNaN(date.getTime())) {
          parts.push(
            date.toLocaleString("he-IL", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })
          );
        }
      }
      break;
    }
    case "documents": {
      const name = str(d.name) ?? str(d.file_name);
      if (name) parts.push(name);
      break;
    }
    case "properties": {
      const name = str(d.name) ?? str(d.address);
      if (name) parts.push(name);
      break;
    }
    case "vehicles": {
      // the car's name lives on the tag row; here show plate / make-model / owner
      const desc = [str(d.make_model), str(d.license_plate)].filter(Boolean).join(" · ");
      if (desc) parts.push(desc);
      const owner = str(d.owner_name);
      if (owner) parts.push(`רשום על שם ${owner}`);
      break;
    }
    case "tags": {
      const name = str(d.name);
      if (name) parts.push(name);
      break;
    }
    case "morning_documents": {
      const typeLabel = str(d.document_type_label);
      if (typeLabel) parts.push(typeLabel);
      const number = str(d.morning_document_number);
      if (number) parts.push(`#${number}`);
      const amt = money(d.amount);
      if (amt) parts.push(amt);
      break;
    }
    case "auth": {
      const email = str(d.email);
      if (email) parts.push(email);
      const device = str(d.device);
      if (device) parts.push(device);
      break;
    }
    case "system": {
      // One row summarizing a reminders-sync batch (see system-rules.ts).
      const count = Number(d.count);
      if (Number.isFinite(count) && count > 0) {
        parts.push(`${count.toLocaleString("he-IL")} תזכורות עודכנו`);
      }
      const bits: string[] = [];
      const inserted = Number(d.inserted);
      const refreshed = Number(d.refreshed);
      const resolved = Number(d.resolved);
      if (Number.isFinite(inserted) && inserted > 0) bits.push(`${inserted} חדשות`);
      if (Number.isFinite(refreshed) && refreshed > 0) bits.push(`${refreshed} רועננו`);
      if (Number.isFinite(resolved) && resolved > 0) bits.push(`${resolved} נסגרו`);
      if (bits.length) parts.push(bits.join(", "));
      break;
    }
  }

  return parts.join(" · ");
}

export function buildSummary(tableName: string, action: string) {
  return `${entityLabel(tableName)} ${actionLabel(action)}`;
}

// ── Deep links & parent grouping ─────────────────────────────────────────────
// Each audit row can point at the entity it affected so the feed clicks through
// to the real thing. Side-effect rows (order items, stock movements, doc links,
// payment allocations) point at — and collapse under — their parent action.

// Low-level rows that are plumbing of a higher-level action, not actions a user
// performs directly. These fold under their parent in the feed.
const CHILD_TABLES = new Set([
  "order_items",
  "inventory_movements",
  "document_links",
  "worker_payment_allocations",
]);

function recordData(
  newData: AuditLogValue,
  oldData: AuditLogValue
): Record<string, AuditLogValue> | null {
  for (const candidate of [newData, oldData]) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as Record<string, AuditLogValue>;
    }
  }
  return null;
}

// Resolve a "<type>:<uuid>" parent key to a viewable route.
function hrefFromParentKey(parentKey: string | null): string | null {
  if (!parentKey) return null;
  const sep = parentKey.indexOf(":");
  if (sep < 0) return null;
  const type = parentKey.slice(0, sep);
  const id = parentKey.slice(sep + 1);
  if (!id) return null;
  switch (type) {
    case "order": return `/sales/orders/${id}`;
    case "project": return `/projects/${id}`;
    case "customer": return `/customers/${id}`;
    case "worker": return `/payroll/workers/${id}`;
    case "task": return `/tasks/${id}`;
    default: return null;
  }
}

// The parent business entity a row belongs to (for collapsing + linking). Reads
// foreign keys from new_data, falling back to old_data for deletes.
export function buildParentKey(
  tableName: string,
  recordId: string,
  newData: AuditLogValue,
  oldData: AuditLogValue
): string | null {
  const d = recordData(newData, oldData);
  const fk = (key: string): string | null => {
    const v = d?.[key];
    return typeof v === "string" && v ? v : null;
  };

  switch (tableName) {
    case "orders": return `order:${recordId}`;
    case "order_items": {
      const o = fk("order_id");
      return o ? `order:${o}` : null;
    }
    case "inventory_movements": {
      if (d?.source_type === "order") {
        const s = fk("source_id");
        if (s) return `order:${s}`;
      }
      return null;
    }
    case "payments": {
      const o = fk("order_id");
      if (o) return `order:${o}`;
      const p = fk("project_id");
      if (p) return `project:${p}`;
      return null;
    }
    case "projects": return `project:${recordId}`;
    case "customers": return `customer:${recordId}`;
    case "document_links": {
      const et = d?.entity_type;
      const eid = fk("entity_id");
      if (typeof et === "string" && eid) {
        if (et === "order") return `order:${eid}`;
        if (et === "project") return `project:${eid}`;
        if (et === "customer") return `customer:${eid}`;
      }
      return null;
    }
    case "worker_payments":
    case "worker_payment_allocations":
    case "attendance_sessions": {
      const u = fk("user_id");
      return u ? `worker:${u}` : null;
    }
    case "task_comments":
    case "task_members":
    case "task_time_reports": {
      const t = fk("task_id");
      return t ? `task:${t}` : null;
    }
    case "expenses": {
      const o = fk("order_id");
      if (o) return `order:${o}`;
      const p = fk("project_id");
      if (p) return `project:${p}`;
      const c = fk("customer_id");
      if (c) return `customer:${c}`;
      return null;
    }
    case "communications":
    case "communication_logs":
    case "inquiries": {
      const c = fk("customer_id");
      if (c) return `customer:${c}`;
      const p = fk("project_id");
      if (p) return `project:${p}`;
      const o = fk("order_id");
      if (o) return `order:${o}`;
      return null;
    }
    case "reminders": {
      // A reminder points at whatever it's about; task is handled directly in
      // buildHref, so here we resolve its business parent for grouping/linking.
      const c = fk("customer_id");
      if (c) return `customer:${c}`;
      const p = fk("project_id");
      if (p) return `project:${p}`;
      const o = fk("order_id");
      if (o) return `order:${o}`;
      return null;
    }
    default: return null;
  }
}

// Where clicking the row should go. Prefers the parent entity, then a few
// entities that are their own destination (tasks, workers, documents).
export function buildHref(
  tableName: string,
  recordId: string,
  parentKey: string | null
): string | null {
  const fromParent = hrefFromParentKey(parentKey);
  if (fromParent) return fromParent;
  switch (tableName) {
    case "tasks": return `/tasks/${recordId}`;
    case "users": return `/payroll/workers/${recordId}`;
    // Login/logout rows: record_id is the user's users.id → open their profile.
    case "auth": return `/payroll/workers/${recordId}`;
    case "documents": return "/documents";
    case "vehicles": return `/vehicles/${recordId}`;
    case "properties": return "/properties";
    case "products":
    case "product_categories":
    case "inventory_movements": return "/inventory";
    case "expenses":
    case "recurring_expense_templates":
    case "accounts":
    case "expense_installments": return "/financial";
    case "loans":
    case "loan_repayments": return "/financial/loans";
    case "card_statements": return `/financial/statements/${recordId}`;
    case "worker_payments":
    case "salary_agreements":
    case "payroll_periods":
    case "payslips":
    case "payslip_items": return "/payroll";
    default: return null;
  }
}

// Collapse side-effect rows under the action that caused them. A child attaches
// to the nearest non-child header sharing its parent key within a short window
// (one user action's cascade lands within seconds). Order follows the headers'
// positions in the (newest-first) input; unattached children stand alone.
const GROUP_WINDOW_MS = 5 * 60 * 1000;

// Creating OR deleting one entity is several DB writes (e.g. for an order: the
// orders INSERT + its payment INSERT + an optional Morning/collect-on-delivery
// UPDATE; or on delete: the orders DELETE + its payments + inventory_movements
// DELETEs) and the audit trigger logs each — so a brand-new or just-removed
// order looked like a header plus several stray "תשלום"/"עודכן"/"נמחק" rows even
// though it was one action. We fold those follow-up headers under the
// create/delete header when they belong to the same entity and land within this
// window of it. The window is tight so a genuine human edit minutes later still
// stands on its own.
const CASCADE_WINDOW_MS = 60 * 1000;

// A header that anchors a cascade: the INSERT or DELETE of a top-level entity
// whose parentKey is its own (orders/projects/customers). Follow-up writes on
// the same entity (its payments, the same-entity UPDATEs, …) fold under it.
function isCascadeAnchor(it: AuditFeedItem): boolean {
  const isCreate = it.action === "create" || it.action === "INSERT";
  const isDelete = it.action === "delete" || it.action === "DELETE";
  if (!isCreate && !isDelete) return false;
  return (
    it.tableName === "orders" ||
    it.tableName === "projects" ||
    it.tableName === "customers"
  );
}

export function groupAuditFeedItems(items: AuditFeedItem[]): AuditGroup[] {
  const timeOf = (it: AuditFeedItem) =>
    it.createdAt ? new Date(it.createdAt).getTime() : 0;

  type Bucket = { header: AuditFeedItem; children: AuditFeedItem[]; time: number };
  const byHeaderId = new Map<string, Bucket>();
  const byParentKey = new Map<string, Bucket[]>();

  for (const it of items) {
    if (it.isChild) continue;
    const bucket: Bucket = { header: it, children: [], time: timeOf(it) };
    byHeaderId.set(it.id, bucket);
    if (it.parentKey) {
      const arr = byParentKey.get(it.parentKey);
      if (arr) arr.push(bucket);
      else byParentKey.set(it.parentKey, [bucket]);
    }
  }

  const attached = new Set<string>();
  for (const it of items) {
    if (!it.isChild || !it.parentKey) continue;
    const candidates = byParentKey.get(it.parentKey);
    if (!candidates) continue;
    const t = timeOf(it);
    let best: Bucket | null = null;
    let bestDiff = Infinity;
    for (const c of candidates) {
      const diff = Math.abs(c.time - t);
      if (diff <= GROUP_WINDOW_MS && diff < bestDiff) {
        best = c;
        bestDiff = diff;
      }
    }
    if (best) {
      best.children.push(it);
      attached.add(it.id);
    }
  }

  // Fold the cascade: each non-anchor header sharing a create/delete anchor's
  // parentKey within the tight window collapses under that anchor (along with
  // any side-effect children it had already gathered).
  const folded = new Set<string>();
  for (const it of items) {
    if (it.isChild || !it.parentKey || isCascadeAnchor(it)) continue;
    const candidates = byParentKey.get(it.parentKey);
    if (!candidates) continue;
    const t = timeOf(it);
    let anchor: Bucket | null = null;
    let bestDiff = Infinity;
    for (const c of candidates) {
      if (c.header.id === it.id || !isCascadeAnchor(c.header)) continue;
      const diff = Math.abs(c.time - t);
      if (diff <= CASCADE_WINDOW_MS && diff < bestDiff) {
        anchor = c;
        bestDiff = diff;
      }
    }
    if (anchor) {
      const own = byHeaderId.get(it.id);
      anchor.children.push(it, ...(own ? own.children : []));
      folded.add(it.id);
    }
  }

  const result: AuditGroup[] = [];
  for (const it of items) {
    if (!it.isChild) {
      if (folded.has(it.id)) continue;
      const bucket = byHeaderId.get(it.id);
      if (bucket) result.push({ header: bucket.header, children: bucket.children });
    } else if (!attached.has(it.id)) {
      result.push({ header: it, children: [] });
    }
  }
  return result;
}

// ── Human titles ─────────────────────────────────────────────────────────────
// Resolve a human name for each row's entity (customer / project / worker), so
// the feed reads "הזמנה · ביאן מרקט" instead of just "הזמנה". Names live behind
// foreign keys, so we batch a handful of lookups for a page of rows at once.

type NamedRow = { id?: string | null; name?: string | null };

export async function resolveAuditTitles(
  supabase: SupabaseClient,
  rows: AuditLogRow[]
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  if (rows.length === 0) return titles;

  const dataOf = (r: AuditLogRow) => recordData(r.new_data ?? null, r.old_data ?? null);
  const fk = (d: Record<string, AuditLogValue> | null, key: string): string | null => {
    const v = d?.[key];
    return typeof v === "string" && v ? v : null;
  };
  const inline = (d: Record<string, AuditLogValue> | null, key: string): string | null => {
    const v = d?.[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };

  const customerIds = new Set<string>();
  const projectIds = new Set<string>();
  const userIds = new Set<string>();
  const orderIds = new Set<string>(); // resolved one hop further → their customer

  for (const r of rows) {
    const d = dataOf(r);
    switch (r.table_name) {
      case "orders": {
        const c = fk(d, "customer_id");
        if (c) customerIds.add(c);
        break;
      }
      case "order_items": {
        const o = fk(d, "order_id");
        if (o) orderIds.add(o);
        break;
      }
      case "inventory_movements": {
        const c = fk(d, "customer_id");
        if (c) customerIds.add(c);
        if (d?.source_type === "order") {
          const o = fk(d, "source_id");
          if (o) orderIds.add(o);
        }
        break;
      }
      case "payments": {
        const o = fk(d, "order_id");
        if (o) orderIds.add(o);
        const p = fk(d, "project_id");
        if (p) projectIds.add(p);
        break;
      }
      case "worker_payments":
      case "worker_payment_allocations":
      case "attendance_sessions": {
        const u = fk(d, "user_id");
        if (u) userIds.add(u);
        break;
      }
      case "document_links": {
        const et = d?.entity_type;
        const eid = fk(d, "entity_id");
        if (eid && et === "order") orderIds.add(eid);
        else if (eid && et === "project") projectIds.add(eid);
        else if (eid && et === "customer") customerIds.add(eid);
        break;
      }
    }
  }

  // First hop: order → its customer (so an order/payment shows the buyer's name).
  const orderCustomer = new Map<string, string>();
  if (orderIds.size > 0) {
    const { data } = await supabase
      .from("orders")
      .select("id,customer_id")
      .in("id", Array.from(orderIds));
    for (const row of (data ?? []) as { id?: string; customer_id?: string }[]) {
      if (typeof row.id === "string" && typeof row.customer_id === "string") {
        orderCustomer.set(row.id, row.customer_id);
        customerIds.add(row.customer_id);
      }
    }
  }

  const [customerRes, projectRes, userNames] = await Promise.all([
    customerIds.size > 0
      ? supabase.from("customers").select("id,name").in("id", Array.from(customerIds))
      : Promise.resolve({ data: [] as NamedRow[] }),
    projectIds.size > 0
      ? supabase.from("projects").select("id,name").in("id", Array.from(projectIds))
      : Promise.resolve({ data: [] as NamedRow[] }),
    userIds.size > 0
      ? resolveUserDisplayNamesForValues(supabase, Array.from(userIds))
      : Promise.resolve({} as Record<string, string>),
  ]);

  const customerName = new Map<string, string>();
  for (const row of (customerRes.data ?? []) as NamedRow[]) {
    if (typeof row.id === "string" && typeof row.name === "string" && row.name.trim()) {
      customerName.set(row.id, row.name.trim());
    }
  }
  const projectName = new Map<string, string>();
  for (const row of (projectRes.data ?? []) as NamedRow[]) {
    if (typeof row.id === "string" && typeof row.name === "string" && row.name.trim()) {
      projectName.set(row.id, row.name.trim());
    }
  }

  const customerOfOrder = (orderId: string | null) => {
    if (!orderId) return null;
    const c = orderCustomer.get(orderId);
    return c ? customerName.get(c) ?? null : null;
  };

  for (const r of rows) {
    const d = dataOf(r);
    let title: string | null = null;
    switch (r.table_name) {
      case "customers":
        title = inline(d, "name");
        break;
      case "projects":
        title = inline(d, "name");
        break;
      case "tasks":
        title = inline(d, "subject") ?? inline(d, "title");
        break;
      case "documents":
        title = inline(d, "file_name") ?? inline(d, "name");
        break;
      case "properties":
        title = inline(d, "name") ?? inline(d, "address");
        break;
      case "orders": {
        const c = fk(d, "customer_id");
        title = c ? customerName.get(c) ?? null : null;
        break;
      }
      case "order_items":
        title = customerOfOrder(fk(d, "order_id"));
        break;
      case "inventory_movements": {
        const c = fk(d, "customer_id");
        title =
          (c ? customerName.get(c) ?? null : null) ??
          (d?.source_type === "order" ? customerOfOrder(fk(d, "source_id")) : null);
        break;
      }
      case "payments": {
        title =
          customerOfOrder(fk(d, "order_id")) ??
          (() => {
            const p = fk(d, "project_id");
            return p ? projectName.get(p) ?? null : null;
          })();
        break;
      }
      case "worker_payments":
      case "worker_payment_allocations":
      case "attendance_sessions": {
        const u = fk(d, "user_id");
        title = u ? userNames[u] ?? null : null;
        break;
      }
    }
    if (title) titles.set(r.id, title);
  }

  return titles;
}

// ── Field-level change detail ("what happened") ─────────────────────────────
// Shown for update actions: compares old_data → new_data on a curated set of
// meaningful fields so the feed reads e.g. "סטטוס: פתוח → הושלם".

const CHANGE_FIELD_LABELS: Record<string, string> = {
  status: "סטטוס",
  payment_status: "סטטוס תשלום",
  collection_status: "סטטוס גבייה",
  priority: "עדיפות",
  amount: "סכום",
  total_price: "סכום",
  total_amount: "סכום",
  agreed_base_price: "מחיר",
  actual_price: "מחיר",
  payment_method: "אמצעי תשלום",
  name: "שם",
  full_name: "שם",
  phone: "טלפון",
  email: "אימייל",
  subject: "נושא",
  title: "נושא",
  description: "תיאור",
  due_date: "לתשלום עד",
  start_date: "תאריך התחלה",
  end_date: "תאריך סיום",
  // vehicles (רכבים)
  license_plate: "מספר רישוי",
  make_model: "יצרן / דגם",
  year: "שנת ייצור",
  test_due_date: "טסט",
  insurance_due_date: "ביטוח",
  license_due_date: "רישוי",
  owner_name: "רשום על שם",
  notes: "הערות",
};

// Order controls how changes are listed; first matches win.
const CHANGE_FIELDS = Object.keys(CHANGE_FIELD_LABELS);

// Masculine, project-wide (see feedback-hebrew-gender-agreement). Covers every
// stored status value we might diff so no raw English leaks into the feed.
const STATUS_VALUE_LABELS: Record<string, string> = {
  open: "פתוח", closed: "סגור", active: "פעיל", inactive: "לא פעיל",
  pending: "ממתין", in_progress: "בתהליך", completed: "הושלם", done: "הושלם",
  todo: "לביצוע", to_do: "לביצוע", blocked: "חסום", on_hold: "מושהה",
  cancelled: "בוטל", canceled: "בוטל", paid: "שולם", unpaid: "לא שולם",
  partial: "חלקי", draft: "טיוטה", new: "חדש", lost: "אבוד", won: "זכה",
  low: "נמוכה", medium: "בינונית", high: "גבוהה", urgent: "דחופה",
  // order fulfilment / delivery statuses
  delivered: "נמסר", shipped: "נשלח", collected: "נאסף", ready: "מוכן",
  processing: "בעיבוד", confirmed: "אושר", in_transit: "במשלוח",
  returned: "הוחזר", refunded: "זוכה", not_paid: "לא שולם",
  approved: "אושר", rejected: "נדחה", sent: "נשלח", overdue: "באיחור",
  issued: "הונפק", needs_invoice: "דורש חשבונית", scheduled: "מתוזמן",
  failed: "נכשל", success: "הצליח", contacted: "נוצר קשר", promised: "הובטח",
  // payment methods
  cash: "מזומן", credit: "אשראי", credit_card: "אשראי", card: "אשראי",
  check: "צ׳ק", cheque: "צ׳ק", bank_transfer: "העברה בנקאית", transfer: "העברה",
  bit: "ביט", paybox: "פייבוקס", other: "אחר",
  // booleans (needs_invoice, is_official, …)
  true: "כן", false: "לא",
};

function formatChangeValue(field: string, value: AuditLogValue): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "amount" || field.endsWith("_price") || field.endsWith("_amount")) {
    const n = Number(value);
    if (Number.isFinite(n)) return `₪${n.toLocaleString("he-IL")}`;
  }
  const s = String(value);
  return STATUS_VALUE_LABELS[s] ?? s;
}

function isUpdateAction(action: string): boolean {
  return action === "update" || action === "UPDATE" || action === "status_changed" || action === "priority_changed";
}

function buildChangeList(oldData: AuditLogValue, newData: AuditLogValue): AuditChange[] {
  if (!oldData || typeof oldData !== "object" || Array.isArray(oldData)) return [];
  if (!newData || typeof newData !== "object" || Array.isArray(newData)) return [];
  const o = oldData as Record<string, AuditLogValue>;
  const n = newData as Record<string, AuditLogValue>;

  const out: AuditChange[] = [];
  const seen = new Set<string>();
  for (const field of CHANGE_FIELDS) {
    if (!(field in o) && !(field in n)) continue;
    const before = o[field] ?? null;
    const after = n[field] ?? null;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const change: AuditChange = {
      label: CHANGE_FIELD_LABELS[field],
      before: formatChangeValue(field, before),
      after: formatChangeValue(field, after),
    };
    // Skip duplicates (e.g. agreed_base_price + actual_price both → "מחיר").
    const key = `${change.label}|${change.before}|${change.after}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(change);
    if (out.length >= 3) break;
  }
  return out;
}

function changeListToString(changes: AuditChange[]): string {
  return changes.map((c) => `${c.label}: ${c.before} → ${c.after}`).join(" · ");
}

function actorDisplayName(actor: AuditActorRow) {
  if (typeof actor.full_name === "string" && actor.full_name.trim()) {
    return actor.full_name.trim();
  }
  if (typeof actor.email === "string" && actor.email.trim()) {
    return actor.email.trim();
  }
  return "משתמש";
}

export async function resolveUserDisplayNamesForValues(
  supabase: SupabaseClient,
  values: string[]
) {
  const uniqueValues = Array.from(new Set(values.filter(Boolean)));
  if (uniqueValues.length === 0) return {} as Record<string, string>;

  const [byIdResult, byAuthUserIdResult] = await Promise.all([
    supabase
      .from("users")
      .select("id,auth_user_id,full_name,email")
      .in("id", uniqueValues),
    supabase
      .from("users")
      .select("id,auth_user_id,full_name,email")
      .in("auth_user_id", uniqueValues),
  ]);

  const map: Record<string, string> = {};
  for (const row of [
    ...((byIdResult.data ?? []) as AuditActorRow[]),
    ...((byAuthUserIdResult.data ?? []) as AuditActorRow[]),
  ]) {
    const displayName = actorDisplayName(row);
    if (typeof row.id === "string" && row.id) {
      map[row.id] = displayName;
    }
    if (typeof row.auth_user_id === "string" && row.auth_user_id) {
      map[row.auth_user_id] = displayName;
    }
  }

  return map;
}

async function getActorNames(supabase: SupabaseClient, actorIds: string[]) {
  const resolved = await resolveUserDisplayNamesForValues(supabase, actorIds);
  return new Map(Object.entries(resolved));
}

// Like resolveUserDisplayNamesForValues but returns each actor's chosen avatar
// color, keyed by both id and auth_user_id. Used by the live feed so a row that
// arrives via realtime carries the actor's color immediately (not just after the
// next server refresh).
export async function resolveUserColorsForValues(
  supabase: SupabaseClient,
  values: string[]
) {
  const uniqueValues = Array.from(new Set(values.filter(Boolean)));
  if (uniqueValues.length === 0) return {} as Record<string, string>;

  const [byIdResult, byAuthUserIdResult] = await Promise.all([
    supabase.from("users").select("id,auth_user_id,avatar_color").in("id", uniqueValues),
    supabase.from("users").select("id,auth_user_id,avatar_color").in("auth_user_id", uniqueValues),
  ]);

  const map: Record<string, string> = {};
  for (const row of [
    ...((byIdResult.data ?? []) as AuditActorRow[]),
    ...((byAuthUserIdResult.data ?? []) as AuditActorRow[]),
  ]) {
    const color =
      typeof row.avatar_color === "string" && row.avatar_color.trim() ? row.avatar_color.trim() : null;
    if (!color) continue;
    if (typeof row.id === "string" && row.id) map[row.id] = color;
    if (typeof row.auth_user_id === "string" && row.auth_user_id) map[row.auth_user_id] = color;
  }

  return map;
}

// Like getActorNames but also resolves each actor's chosen avatar color, in the
// same pair of queries. changed_by holds a mix of users.id and auth_user_id, so
// both maps are keyed by both ids (see resolveUserDisplayNamesForValues).
async function getActorInfo(
  supabase: SupabaseClient,
  actorIds: string[]
): Promise<{ names: Map<string, string>; colors: Map<string, string> }> {
  const names = new Map<string, string>();
  const colors = new Map<string, string>();
  const uniqueValues = Array.from(new Set(actorIds.filter(Boolean)));
  if (uniqueValues.length === 0) return { names, colors };

  const [byIdResult, byAuthUserIdResult] = await Promise.all([
    supabase
      .from("users")
      .select("id,auth_user_id,full_name,email,avatar_color")
      .in("id", uniqueValues),
    supabase
      .from("users")
      .select("id,auth_user_id,full_name,email,avatar_color")
      .in("auth_user_id", uniqueValues),
  ]);

  for (const row of [
    ...((byIdResult.data ?? []) as AuditActorRow[]),
    ...((byAuthUserIdResult.data ?? []) as AuditActorRow[]),
  ]) {
    const name = actorDisplayName(row);
    const color =
      typeof row.avatar_color === "string" && row.avatar_color.trim()
        ? row.avatar_color.trim()
        : null;
    for (const key of [row.id, row.auth_user_id]) {
      if (typeof key === "string" && key) {
        names.set(key, name);
        if (color) colors.set(key, color);
      }
    }
  }

  return { names, colors };
}

// The audit_logs.changed_by column holds a MIX of identifiers: the DB trigger
// writes auth.uid() (a users.auth_user_id) while app-side events write users.id.
// So filtering the feed by one person means matching BOTH of their ids.
export async function resolveActorFilterValues(
  supabase: SupabaseClient,
  userId: string
): Promise<string[]> {
  if (!userId) return [];
  const { data } = await supabase
    .from("users")
    .select("id,auth_user_id")
    .eq("id", userId)
    .maybeSingle();
  const values = new Set<string>([userId]);
  const authId = (data as { auth_user_id?: string | null } | null)?.auth_user_id;
  if (typeof authId === "string" && authId) values.add(authId);
  return Array.from(values);
}

// People who can appear as actors in the feed, for the "filter by worker"
// dropdown. value = users.id (resolved to both ids at query time).
export async function getAuditActorOptions(
  supabase: SupabaseClient
): Promise<{ value: string; label: string }[]> {
  const { data } = await supabase
    .from("users")
    .select("id,auth_user_id,full_name,email")
    .order("full_name", { ascending: true });
  const rows = (data ?? []) as AuditActorRow[];
  return rows
    .filter((r) => typeof r.id === "string" && r.id)
    .map((r) => ({ value: r.id, label: actorDisplayName(r) }));
}

// ── Presence roster ──────────────────────────────────────────────────────────
// Backs the "מחוברים כעת" bar. "Active now" is server-authoritative — a user_sessions
// heartbeat within the last 2 min — so the viewer sees themselves regardless of
// whether flaky Realtime presence connected. Everyone active in the last 30 days
// is listed; inactive ones show last-seen. sessionStartedAt gives an accurate
// "connected for X" (real session length, not cookie lifetime).
export type PresenceRosterUser = {
  id: string;
  authUserId: string | null;
  name: string;
  role: string | null;
  avatarColor: string | null;
  lastSeenAt: string | null;
  // "Active now" decided on the SERVER clock (heartbeat within 2 min), so a viewer
  // whose device clock is skewed can't wrongly flip connected users to offline.
  activeNow: boolean;
  // The user's most-recent session's start + last heartbeat (whether or not it's
  // still active), so the bar can show "connected for X" while online and "last
  // session lasted Y" once offline. Null when they have no session yet.
  sessionStartedAt: string | null;
  sessionLastSeenAt: string | null;
};

type RosterUserRow = AuditActorRow & { role?: string | null; last_seen_at?: string | null };

export async function getUserPresenceRoster(
  supabase: SupabaseClient
): Promise<PresenceRosterUser[]> {
  const nowMs = Date.now();
  const since = nowMs - 30 * 24 * 60 * 60 * 1000;
  const sinceIso = new Date(since).toISOString();

  const { data: userRows } = await supabase
    .from("users")
    .select("id,auth_user_id,full_name,email,role,avatar_color,last_seen_at")
    .range(0, 999);
  const users = (userRows ?? []) as RosterUserRow[];
  if (users.length === 0) return [];

  // Latest session per user → active state + accurate current-session start.
  const { data: sessRows } = await supabase
    .from("user_sessions")
    .select("user_id,started_at,last_seen_at,ended_at")
    .gt("last_seen_at", sinceIso)
    .order("last_seen_at", { ascending: false })
    .range(0, 4999);
  const latestSession = new Map<
    string,
    { startedAt: string; lastSeenAt: string; endedAt: string | null }
  >();
  for (const s of (sessRows ?? []) as Array<{
    user_id?: string;
    started_at?: string;
    last_seen_at?: string;
    ended_at?: string | null;
  }>) {
    if (
      typeof s.user_id === "string" && s.user_id && !latestSession.has(s.user_id) &&
      typeof s.started_at === "string" && typeof s.last_seen_at === "string"
    ) {
      latestSession.set(s.user_id, {
        startedAt: s.started_at,
        lastSeenAt: s.last_seen_at,
        endedAt: typeof s.ended_at === "string" ? s.ended_at : null,
      });
    }
  }

  const roster = users.map((u) => {
    const sess = latestSession.get(u.id);
    // Newest of users.last_seen_at and the session's last_seen_at (label only).
    const times = [u.last_seen_at, sess?.lastSeenAt].filter(
      (t): t is string => typeof t === "string" && Boolean(t)
    );
    const lastSeenAt = times.length
      ? times.reduce((a, b) => (new Date(a).getTime() >= new Date(b).getTime() ? a : b))
      : null;
    // Online = a LIVE session (not ended by logout) that heartbeat'd within 2 min.
    // Decided on the server clock; independent of the flaky presence socket.
    const activeNow =
      !!sess &&
      !sess.endedAt &&
      nowMs - new Date(sess.lastSeenAt).getTime() < 2 * 60 * 1000;
    return {
      id: u.id,
      authUserId: typeof u.auth_user_id === "string" ? u.auth_user_id : null,
      name: actorDisplayName(u),
      role: typeof u.role === "string" ? u.role : null,
      avatarColor:
        typeof u.avatar_color === "string" && u.avatar_color.trim() ? u.avatar_color.trim() : null,
      lastSeenAt,
      activeNow,
      sessionStartedAt: sess?.startedAt ?? null,
      sessionLastSeenAt: sess?.lastSeenAt ?? null,
    };
  });

  return roster
    .filter((u) => u.lastSeenAt && new Date(u.lastSeenAt).getTime() > since)
    .sort((a, b) => {
      const at = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
      const bt = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
      return bt - at;
    });
}

export function buildAuditFeedItem(
  row: AuditLogRow,
  actorName: string | null,
  title: string | null = null,
  actorColor: string | null = null
): AuditFeedItem {
  const base = buildDetails(row.table_name, row.new_data ?? null);
  const changes = isUpdateAction(row.action)
    ? buildChangeList(row.old_data ?? null, row.new_data ?? null)
    : [];
  const details = [base, changeListToString(changes)].filter(Boolean).join(" · ");

  const parentKey = buildParentKey(
    row.table_name,
    row.record_id,
    row.new_data ?? null,
    row.old_data ?? null
  );

  return {
    id: row.id,
    tableName: row.table_name,
    recordId: row.record_id,
    action: row.action,
    actionLabel: actionLabel(row.action),
    entityLabel: entityLabel(row.table_name),
    summary: buildSummary(row.table_name, row.action),
    details,
    baseDetails: base,
    changes,
    actorName: row.changed_by ? actorName ?? "משתמש" : "מערכת",
    actorRole: row.user_role,
    actorColor: row.changed_by ? actorColor : null,
    createdAt: row.created_at,
    title,
    parentKey,
    href: buildHref(row.table_name, row.record_id, parentKey),
    isChild: CHILD_TABLES.has(row.table_name),
  };
}

function normalizeAuditRows(
  rows: AuditLogRow[],
  actorNames: Map<string, string>,
  titles?: Map<string, string>,
  actorColors?: Map<string, string>
): AuditFeedItem[] {
  return rows.map((row) =>
    buildAuditFeedItem(
      row,
      row.changed_by ? actorNames.get(row.changed_by) ?? null : null,
      titles?.get(row.id) ?? null,
      row.changed_by ? actorColors?.get(row.changed_by) ?? null : null
    )
  );
}

// Tables covered by the database trigger `log_changes` (trg_audit_*), which
// already writes a full audit_logs row (with old/new data + actor) on every
// INSERT/UPDATE/DELETE. The app must NOT also log plain CRUD for these, or every
// action shows up twice (a bare app row + a detailed trigger row).
// Keep this list in sync with the DB trigger coverage (see
// db/sql/extend_audit_to_all_tables.sql).
export const TRIGGER_AUDITED_TABLES = new Set([
  "orders",
  "order_items",
  "payments",
  "projects",
  "customers",
  "users",
  "contacts",
  "expenses",
  "tasks",
  "documents",
  "attendance_sessions",
  "worker_payments",
  "vehicles",
  "tags",
  // accounts carry the trg_audit_accounts trigger (db/sql/create_accounts.sql),
  // so the /api/financial/accounts route's create/update/delete logAuditEvent
  // calls would otherwise double-log.
  "accounts",
]);

// Plain row-CRUD actions the DB trigger already records. Distinct semantic
// events the trigger can't express (morning_* sync/failure notices, etc.) are
// still logged by the app even on a covered table.
const TRIGGER_HANDLED_ACTIONS = new Set([
  "create",
  "update",
  "delete",
  "status_changed",
  "priority_changed",
  "upload",
]);

// Global audit on/off flag (mirrors business_settings.audit_logging_enabled,
// flipped from Settings → System). Cached briefly so we never pay a read per
// write on a warm server instance.
let auditFlagCache: { value: boolean; at: number } | null = null;
const AUDIT_FLAG_TTL_MS = 60_000;

export function invalidateAuditFlagCache() {
  auditFlagCache = null;
}

async function isAuditLoggingEnabled(supabase: SupabaseClient): Promise<boolean> {
  const now = Date.now();
  if (auditFlagCache && now - auditFlagCache.at < AUDIT_FLAG_TTL_MS) return auditFlagCache.value;
  const { data } = await supabase
    .from("business_settings")
    .select("audit_logging_enabled")
    .eq("id", true)
    .maybeSingle();
  // Default ON if the column/row isn't present yet.
  const value = (data as { audit_logging_enabled?: boolean } | null)?.audit_logging_enabled ?? true;
  auditFlagCache = { value, at: now };
  return value;
}

export async function logAuditEvent({
  supabase,
  tableName,
  recordId,
  action,
  changedBy,
  userRole,
  oldData,
  newData,
}: LogAuditParams) {
  if (!tableName || !recordId || !action) return;

  // Respect the global audit switch (Settings → System).
  if (!(await isAuditLoggingEnabled(supabase))) return;

  // The DB trigger already records plain CRUD for these tables — skip to avoid
  // duplicate rows, but keep distinct semantic events (morning_*, login, etc.).
  if (TRIGGER_AUDITED_TABLES.has(tableName) && TRIGGER_HANDLED_ACTIONS.has(action)) return;

  const { error } = await supabase.from("audit_logs").insert({
    table_name: tableName,
    record_id: recordId,
    action,
    changed_by: changedBy ?? null,
    user_role: userRole ?? null,
    old_data: oldData ?? null,
    new_data: newData ?? null,
  });

  if (error) {
    console.error("Failed to write audit log", {
      tableName,
      recordId,
      action,
      error: toHebrewError(error.message),
    });
  }
}

export async function getRecentAuditEvents(supabase: SupabaseClient, limit = 8) {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id,table_name,record_id,action,changed_by,user_role,created_at,new_data,old_data")
    .order("created_at", { ascending: false })
    .range(0, Math.max(limit - 1, 0));

  if (error) {
    return { items: [] as AuditFeedItem[], error: toHebrewError(error.message) };
  }

  const rows = (data ?? []) as AuditLogRow[];
  const actorIds = Array.from(
    new Set(
      rows
        .map((row) => row.changed_by)
        .filter((value): value is string => typeof value === "string" && Boolean(value))
    )
  );
  const [actorInfo, titles] = await Promise.all([
    getActorInfo(supabase, actorIds),
    resolveAuditTitles(supabase, rows),
  ]);

  return {
    items: normalizeAuditRows(rows, actorInfo.names, titles, actorInfo.colors),
    error: null as string | null,
  };
}

// ── "What you missed" digest ─────────────────────────────────────────────────
// Meaningful events (new/deleted business entities) since the viewer was last
// here. Role-filtered: office sees business + money-in; admin also sees the
// sensitive tables (payroll, users, accounts). This is the "who sees what" gate.
const DIGEST_ACTIONS = ["INSERT", "create", "delete"];
const DIGEST_TABLES_OFFICE = ["orders", "projects", "customers", "payments", "expenses"];
const DIGEST_TABLES_ADMIN = [
  ...DIGEST_TABLES_OFFICE,
  "worker_payments",
  "attendance_sessions",
  "users",
  "accounts",
];

export function digestTablesForRole(role: string | null | undefined): string[] {
  return role === "admin" ? DIGEST_TABLES_ADMIN : DIGEST_TABLES_OFFICE;
}

/**
 * The anchor for "since you were last here": explicit dismissal, else previous login, else now.
 * `seenAt` lets a caller that already loaded the user's `digest_seen_at` (e.g. via
 * requireProfile) pass it in to skip this function's own `users` round-trip.
 * Pass `undefined` (the default) to have it fetched here as before.
 */
export async function getDigestAnchor(
  supabase: SupabaseClient,
  userId: string,
  seenAt?: string | null
): Promise<string> {
  let seen = seenAt;
  if (seen === undefined) {
    const { data: u } = await supabase.from("users").select("digest_seen_at").eq("id", userId).maybeSingle();
    seen = (u as { digest_seen_at?: string | null } | null)?.digest_seen_at;
  }
  if (typeof seen === "string" && seen) return seen;

  // The current session's login is the newest, so the 2nd-most-recent is the prior visit.
  const { data: logins } = await supabase
    .from("audit_logs")
    .select("created_at")
    .eq("table_name", "auth")
    .eq("action", "login")
    .eq("changed_by", userId)
    .order("created_at", { ascending: false })
    .range(0, 1);
  const rows = (logins ?? []) as Array<{ created_at?: string | null }>;
  if (rows.length >= 2 && typeof rows[1].created_at === "string") return rows[1].created_at as string;

  return new Date().toISOString(); // brand-new user → nothing to show yet
}

export async function getMissedDigest(
  supabase: SupabaseClient,
  opts: { sinceIso: string; viewerRole: string | null; excludeActorIds?: string[]; limit?: number }
): Promise<{ items: AuditFeedItem[]; error: string | null }> {
  const limit = opts.limit ?? 40;
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id,table_name,record_id,action,changed_by,user_role,created_at,new_data,old_data")
    .gt("created_at", opts.sinceIso)
    .in("table_name", digestTablesForRole(opts.viewerRole))
    .in("action", DIGEST_ACTIONS)
    .order("created_at", { ascending: false })
    .range(0, limit * 2 - 1);
  if (error) return { items: [], error: toHebrewError(error.message) };

  const exclude = new Set((opts.excludeActorIds ?? []).filter(Boolean));
  const rows = ((data ?? []) as AuditLogRow[]).filter((r) => !exclude.has(r.changed_by ?? "")).slice(0, limit);
  if (rows.length === 0) return { items: [], error: null };

  const actorIds = Array.from(new Set(rows.map((r) => r.changed_by).filter((v): v is string => Boolean(v))));
  const [actorInfo, titles] = await Promise.all([getActorInfo(supabase, actorIds), resolveAuditTitles(supabase, rows)]);
  return { items: normalizeAuditRows(rows, actorInfo.names, titles, actorInfo.colors), error: null };
}

export async function getLatestAuditByRecordIds(
  supabase: SupabaseClient,
  {
    tableName,
    recordIds,
    actions,
  }: {
    tableName: string;
    recordIds: string[];
    actions?: string[];
  }
) {
  if (recordIds.length === 0) {
    return { byRecordId: {} as Record<string, AuditRecordInfo>, error: null as string | null };
  }

  const rowLimit = Math.min(Math.max(recordIds.length * 3, 50), 5000);
  let query = supabase
    .from("audit_logs")
    .select("id,table_name,record_id,action,changed_by,user_role,created_at,new_data,old_data")
    .eq("table_name", tableName)
    .in("record_id", recordIds)
    .order("created_at", { ascending: false });

  if (actions && actions.length > 0) {
    query = query.in("action", actions);
  }

  const { data, error } = await query.range(0, rowLimit - 1);

  if (error) {
    return { byRecordId: {} as Record<string, AuditRecordInfo>, error: toHebrewError(error.message) };
  }

  const rows = (data ?? []) as AuditLogRow[];
  const actorIds = Array.from(
    new Set(
      rows
        .map((row) => row.changed_by)
        .filter((value): value is string => typeof value === "string" && Boolean(value))
    )
  );
  const actorNames = await getActorNames(supabase, actorIds);

  const latestByRecordId: Record<string, AuditRecordInfo> = {};
  for (const row of normalizeAuditRows(rows, actorNames)) {
    if (latestByRecordId[row.recordId]) continue;
    latestByRecordId[row.recordId] = {
      action: row.action,
      actionLabel: row.actionLabel,
      entityLabel: row.entityLabel,
      summary: row.summary,
      details: row.details,
      actorName: row.actorName,
      actorRole: row.actorRole,
      createdAt: row.createdAt,
    };
  }

  return {
    byRecordId: latestByRecordId,
    error: null as string | null,
  };
}

// ── Per-entity timeline ──────────────────────────────────────────────────────
// "Everything that happened to THIS order/project/customer." A source is either
// the entity's own rows (by primary key) or related rows that reference it
// through a foreign key stored in new_data (e.g. payments.order_id).
export type EntityAuditSource =
  | { tableName: string; recordId: string }
  | { tableName: string; jsonKey: string; value: string }
  | { tableName: string; jsonKey: string; values: string[] };

export async function getEntityAuditTrail(
  supabase: SupabaseClient,
  sources: EntityAuditSource[],
  limit = 30
): Promise<{ items: AuditFeedItem[]; error: string | null }> {
  // Drop multi-value sources with nothing to match (an empty IN(...) would
  // either error or return everything depending on the driver).
  const active = sources.filter((s) => !("values" in s) || s.values.length > 0);
  if (active.length === 0) return { items: [], error: null };

  const select =
    "id,table_name,record_id,action,changed_by,user_role,created_at,new_data,old_data";

  const results = await Promise.all(
    active.map((source) => {
      let query = supabase
        .from("audit_logs")
        .select(select)
        .eq("table_name", source.tableName)
        .order("created_at", { ascending: false })
        .limit(limit);
      if ("recordId" in source) {
        query = query.eq("record_id", source.recordId);
      } else if ("values" in source) {
        query = query.in(`new_data->>${source.jsonKey}`, source.values);
      } else {
        query = query.filter(`new_data->>${source.jsonKey}`, "eq", source.value);
      }
      return query;
    })
  );

  const firstError = results.find((r) => r.error)?.error;
  if (firstError) {
    return { items: [], error: toHebrewError(firstError.message) };
  }

  // Merge, dedupe by id, newest first, cap.
  const byId = new Map<string, AuditLogRow>();
  for (const r of results) {
    for (const row of (r.data ?? []) as AuditLogRow[]) {
      if (row?.id && !byId.has(row.id)) byId.set(row.id, row);
    }
  }
  const rows = Array.from(byId.values())
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, limit);

  const actorIds = Array.from(
    new Set(rows.map((r) => r.changed_by).filter((v): v is string => typeof v === "string" && Boolean(v)))
  );
  const [actorInfo, titles] = await Promise.all([
    getActorInfo(supabase, actorIds),
    resolveAuditTitles(supabase, rows),
  ]);

  return { items: normalizeAuditRows(rows, actorInfo.names, titles, actorInfo.colors), error: null };
}

export const AUDIT_PAGE_SIZE = 50;

export const AUDIT_TABLE_OPTIONS = [
  { value: "", label: "כל הסוגים" },
  { value: "projects", label: "פרויקטים" },
  { value: "tasks", label: "משימות" },
  { value: "payments", label: "תשלומים" },
  { value: "expenses", label: "הוצאות" },
  { value: "customers", label: "לקוחות" },
  { value: "orders", label: "הזמנות" },
  { value: "properties", label: "נכסים" },
  { value: "documents", label: "מסמכים" },
  { value: "attendance_sessions", label: "שעות עבודה" },
  { value: "worker_payments", label: "תשלומי עובדים" },
  { value: "users", label: "משתמשים" },
  { value: "auth", label: "כניסות למערכת" },
] as const;

export const AUDIT_ACTION_OPTIONS = [
  { value: "", label: "כל הפעולות" },
  { value: "create", label: "יצירה" },
  { value: "update", label: "עדכון" },
  { value: "delete", label: "מחיקה" },
  { value: "status_changed", label: "שינוי סטטוס" },
  { value: "upload", label: "העלאה" },
  { value: "login", label: "התחברות" },
  { value: "logout", label: "התנתקות" },
] as const;

function formatDurationHe(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return "פחות מדקה";
  if (min < 60) return `${min} דק'`;
  const hrs = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${hrs} שע' ${rem} דק'` : `${hrs} שע'`;
}

// For logout rows, fill in "how long they were logged in" (logout time − the most
// recent login before it). auth rows store the user's id in record_id, and the
// login/logout pair are both written app-side, so we pair by record_id. Mutates
// the passed items; a no-op (no query) when the page has no logout rows.
async function enrichLogoutDurations(
  supabase: SupabaseClient,
  items: AuditFeedItem[]
): Promise<void> {
  const logouts = items.filter(
    (i) => i.tableName === "auth" && i.action === "logout" && i.createdAt && i.recordId
  );
  if (logouts.length === 0) return;

  const userIds = Array.from(new Set(logouts.map((i) => i.recordId)));
  const { data } = await supabase
    .from("audit_logs")
    .select("record_id,created_at")
    .eq("table_name", "auth")
    .eq("action", "login")
    .in("record_id", userIds)
    .order("created_at", { ascending: false })
    .range(0, 999);

  const loginsByUser = new Map<string, number[]>();
  for (const r of (data ?? []) as Array<{ record_id?: string; created_at?: string }>) {
    if (typeof r.record_id === "string" && typeof r.created_at === "string") {
      const t = new Date(r.created_at).getTime();
      if (!Number.isNaN(t)) {
        const arr = loginsByUser.get(r.record_id) ?? [];
        arr.push(t); // already newest-first from the query order
        loginsByUser.set(r.record_id, arr);
      }
    }
  }

  for (const item of logouts) {
    const logoutT = new Date(item.createdAt as string).getTime();
    const prior = (loginsByUser.get(item.recordId) ?? []).find((t) => t < logoutT);
    if (prior === undefined) continue;
    const label = `היה מחובר ${formatDurationHe(logoutT - prior)}`;
    item.baseDetails = label;
    item.details = item.details ? `${label} · ${item.details}` : label;
  }
}

export async function getAuditFeedPaginated(
  supabase: SupabaseClient,
  {
    page = 1,
    tableName,
    action,
    changedBy,
    changedByValues,
  }: {
    page?: number;
    tableName?: string | null;
    action?: string | null;
    // A users.id to filter by. Resolved to its (id + auth_user_id) pair here when
    // changedByValues isn't already supplied by the caller.
    changedBy?: string | null;
    // Pre-resolved changed_by values (id + auth_user_id) — pass these to avoid a
    // per-page lookup (the infinite-scroll caller already has them).
    changedByValues?: string[] | null;
  } = {}
) {
  const safePage = Math.max(1, Math.floor(page));
  const offset = (safePage - 1) * AUDIT_PAGE_SIZE;

  let query = supabase
    .from("audit_logs")
    .select("id,table_name,record_id,action,changed_by,user_role,created_at,new_data,old_data", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + AUDIT_PAGE_SIZE - 1);

  if (tableName) query = query.eq("table_name", tableName);
  if (action) query = query.eq("action", action);
  const actorValues =
    changedByValues && changedByValues.length
      ? changedByValues
      : changedBy
        ? await resolveActorFilterValues(supabase, changedBy)
        : [];
  if (actorValues.length) query = query.in("changed_by", actorValues);

  const { data, error, count } = await query;

  if (error) {
    return { items: [] as AuditFeedItem[], totalCount: 0, page: safePage, totalPages: 1, error: toHebrewError(error.message) };
  }

  const rows = (data ?? []) as AuditLogRow[];
  const actorIds = Array.from(
    new Set(rows.map((r) => r.changed_by).filter((v): v is string => typeof v === "string" && Boolean(v)))
  );
  const [actorInfo, titles] = await Promise.all([
    getActorInfo(supabase, actorIds),
    resolveAuditTitles(supabase, rows),
  ]);
  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / AUDIT_PAGE_SIZE));

  const items = normalizeAuditRows(rows, actorInfo.names, titles, actorInfo.colors);
  await enrichLogoutDurations(supabase, items);

  return {
    items,
    totalCount,
    page: safePage,
    totalPages,
    error: null as string | null,
  };
}

// Count of audit rows recorded since local midnight — the "N פעולות היום" the
// activity header shows. A head-only count query, so it's cheap. Returns 0 on
// error rather than throwing; the subtitle just shows "0 פעולות היום".
export async function getAuditActionsTodayCount(supabase: SupabaseClient): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString());
  if (error) return 0;
  return count ?? 0;
}
