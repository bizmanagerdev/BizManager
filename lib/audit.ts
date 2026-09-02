import { formatShortDate } from "@/lib/date";
import { toHebrewError } from "@/lib/error-messages";
import { formatMoney } from "@/lib/money";
import { ORDER_NOTES_SEPARATOR } from "@/lib/orders/comments";
import { getSalaryTypeLabel } from "@/lib/payroll";
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

export function entityLabel(tableName: string, data?: Record<string, AuditLogValue> | null) {
  switch (tableName) {
    case "projects": return "פרויקט";
    case "tasks": return "משימה";
    case "expenses": return "הוצאה";
    case "project_expenses": return "הוצאה בפרויקט";
    case "payments": return "תשלום";
    case "documents": return "מסמך";
    case "customers": return "לקוח";
    case "orders": return "הזמנה";
    case "properties": return "נכס";
    case "users": return "משתמש";
    case "attendance_sessions": return "שעות עבודה";
    case "worker_payments": return "תשלום לעובד";
    case "worker_payment_allocations": return "הקצאת תשלום";
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
    case "recurring_task_template_assignees": return "משתתף במשימה קבועה";
    // The same table holds three different origins for a clocked shift — a real
    // phone call-in, one manually keyed in for someone (still "phone" in spirit),
    // and one the worker logged himself through the app on his own smartphone.
    // Those are NOT the same event and must read differently in the feed (see
    // [[phone-attendance-callin]] and attendanceSourceLabel in
    // lib/attendance/my-shift.ts, which draws the same distinction for the
    // approval queue).
    case "phone_attendance_reports": {
      const source = typeof data?.source === "string" ? data.source : null;
      if (source === "app") return "דיווח נוכחות מהאפליקציה";
      if (source === "phone_manual") return "דיווח נוכחות ידני";
      return "דיווח נוכחות טלפוני";
    }
    case "worker_absences": return "יום חופש";
    case "payslip_items": return "רכיב תלוש";
    case "property_expenses": return "הוצאת נכס";
    case "lease_agreements": return "הסכם שכירות";
    case "payment_promises": return "הבטחת תשלום";
    case "hourly_salary_overrides": return "התאמת שכר שעתי";
    case "dunning_stages": return "שלב תזכורת גבייה";
    // Denylisted from auditing going forward (see migration
    // 20260825120000_close_audit_coverage_drift.sql) — kept here only so any
    // rows already logged before that don't read in raw English.
    case "notifications": return "התראה";
    case "communications": return "תקשורת";
    case "communication_logs": return "תקשורת";
    case "task_comments": return "תגובה";
    case "task_members": return "משתתף במשימה";
    case "task_time_reports": return "דיווח זמן";
    case "loans": return "הלוואה";
    case "loan_repayments": return "החזר הלוואה";
    case "accounts": return "חשבון";
    case "account_transfers": return "העברה בין חשבונות";
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
    // Login/logout rows: the person is already in the actor column, so the record
    // column names what happened — "כניסה למערכת · נכנס / יצא".
    case "auth": return "כניסה למערכת";
    case "system": return "מערכת";
    default: return tableName;
  }
}

export function actionLabel(action: string) {
  switch (action) {
    case "login":
      return "נכנס";
    case "logout":
      return "יצא";
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
    // payments' amount column is amount_total (gross — see [[vat-tax-model]]:
    // income is never netted), NOT `amount` — that name only exists on
    // worker_payments/account_transfers below. This was silently reading a
    // field that doesn't exist on this table, so every payment row showed no
    // amount at all.
    case "payments": {
      const amt = money(d.amount_total);
      if (amt) parts.push(amt);
      const method = str(d.payment_method);
      if (method) parts.push(STATUS_VALUE_LABELS[method] ?? method);
      const note = str(d.notes);
      if (note) parts.push(note);
      break;
    }
    case "worker_payments":
    // account_transfers only stores account IDs, so the feed shows the amount
    // and the note; which accounts is visible in the register itself.
    case "account_transfers": {
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
    case "project_expenses": {
      const note = str(d.notes);
      if (note) parts.push(note);
      if (d.billed_to_customer === true) parts.push("חויב ללקוח");
      break;
    }
    case "worker_payment_allocations": {
      const amt = money(d.amount);
      if (amt) parts.push(amt);
      break;
    }
    case "payslips": {
      const gross = money(d.gross_salary);
      if (gross) parts.push(gross);
      const type = str(d.calculated_salary_type);
      if (type) parts.push(getSalaryTypeLabel(type));
      const minutes = Number(d.total_work_minutes);
      if (Number.isFinite(minutes) && minutes > 0) {
        parts.push(`${(minutes / 60).toLocaleString("he-IL", { maximumFractionDigits: 1 })} שעות`);
      }
      // Can be negative (a downward correction), so this doesn't go through the
      // `money` helper above, which only ever shows positive amounts.
      const adj = Number(d.manual_adjustments);
      if (Number.isFinite(adj) && adj !== 0) parts.push(`התאמה ${formatMoney(adj)}`);
      const note = str(d.notes);
      if (note) parts.push(note);
      break;
    }
    case "payslip_items": {
      const type = str(d.item_type);
      if (type) parts.push(PAYSLIP_ITEM_TYPE_LABELS[type] ?? type);
      // A deduction/negative correction is stored as a negative amount.
      const amt = Number(d.amount);
      if (Number.isFinite(amt) && amt !== 0) parts.push(formatMoney(amt));
      const note = str(d.notes);
      if (note) parts.push(note);
      break;
    }
    case "tasks": {
      const subj = str(d.subject) ?? str(d.title);
      if (subj) parts.push(subj);
      break;
    }
    case "recurring_task_templates": {
      const subj = str(d.subject_template);
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
      break;
    }
    case "orders": {
      const amt = money(d.total_price) ?? money(d.total_amount);
      if (amt) parts.push(amt);
      break;
    }
    case "loans": {
      const direction = str(d.direction);
      if (direction === "given") parts.push("הלוואה שניתנה");
      else if (direction === "taken") parts.push("הלוואה שנלקחה");
      const amt = money(d.amount);
      if (amt) parts.push(amt);
      const dueDate = str(d.due_date);
      if (dueDate) parts.push(`לפירעון: ${formatShortDate(dueDate, dueDate)}`);
      break;
    }
    case "loan_repayments": {
      const amt = money(d.amount);
      if (amt) parts.push(amt);
      const interest = money(d.interest_amount);
      if (interest) parts.push(`ריבית ${interest}`);
      const dateStr = str(d.repayment_date);
      if (dateStr) parts.push(formatShortDate(dateStr, dateStr));
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
    case "phone_attendance_reports": {
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
      const status = str(d.status);
      if (status) parts.push(STATUS_VALUE_LABELS[status] ?? status);
      break;
    }
    case "worker_absences": {
      const dateStr = str(d.absence_date);
      if (dateStr) parts.push(formatShortDate(dateStr, dateStr));
      const type = str(d.absence_type);
      if (type) parts.push(ABSENCE_TYPE_LABELS[type] ?? type);
      break;
    }
    case "hourly_salary_overrides": {
      const rate = money(d.override_hourly_rate);
      if (rate) parts.push(`${rate}/שעה`);
      const reason = str(d.reason);
      if (reason) parts.push(reason);
      break;
    }
    case "payment_promises": {
      const amt = money(d.amount);
      if (amt) parts.push(amt);
      const dateStr = str(d.promised_date);
      if (dateStr) parts.push(formatShortDate(dateStr, dateStr));
      const status = str(d.status);
      if (status) parts.push(STATUS_VALUE_LABELS[status] ?? status);
      break;
    }
    case "lease_agreements": {
      const rent = money(d.monthly_rent_amount);
      if (rent) parts.push(`${rent}/חודש`);
      const dateStr = str(d.start_date);
      if (dateStr) parts.push(formatShortDate(dateStr, dateStr));
      break;
    }
    case "dunning_stages": {
      const label = str(d.label);
      if (label) parts.push(label);
      const offset = Number(d.day_offset);
      if (Number.isFinite(offset)) parts.push(`יום ${offset} מהמועד`);
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
      // The actor column already names the person, so the email would just be
      // noise. What matters here is how long they were active, and that's filled
      // in later by enrichLogoutDurations (it needs a query).
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

export function buildSummary(tableName: string, action: string, data?: Record<string, AuditLogValue> | null) {
  return `${entityLabel(tableName, data)} ${actionLabel(action)}`;
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
  "project_expenses",
  "recurring_task_template_assignees",
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
    case "recurring_task_template": return "/tasks/recurring";
    case "vehicle": return `/vehicles/${id}`;
    case "property": return `/properties/${id}`;
    case "document": return buildFocusHref("/documents", id);
    case "expense": return buildFocusHref("/financial", `expense:${id}`);
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
    case "recurring_task_templates": return `recurring_task_template:${recordId}`;
    case "recurring_task_template_assignees": {
      const t = fk("recurring_task_template_id");
      return t ? `recurring_task_template:${t}` : null;
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
    // A tag applied to something → that something's page (this is the vehicles
    // backbone, so a car tag lands on the car).
    case "entity_tags": {
      const et = d?.entity_type;
      const eid = fk("entity_id");
      if (typeof et === "string" && eid) {
        switch (et) {
          case "order": return `order:${eid}`;
          case "project": return `project:${eid}`;
          case "customer": return `customer:${eid}`;
          case "task": return `task:${eid}`;
          case "vehicle": return `vehicle:${eid}`;
          case "document": return `document:${eid}`;
          case "expense": return `expense:${eid}`;
        }
      }
      return null;
    }
    case "worker_payments":
    case "attendance_sessions":
    case "payslips": {
      const u = fk("user_id");
      return u ? `worker:${u}` : null;
    }
    // No user_id on this table (only worker_payment_id) — resolving it to the
    // worker would need a join we can't do in this synchronous pass, so it
    // stands alone rather than folding under its worker_payments row. Its title
    // (the worker's name) is still resolved async in resolveAuditTitles.
    case "worker_payment_allocations": return null;
    case "task_comments":
    case "task_members":
    case "task_time_reports": {
      const t = fk("task_id");
      return t ? `task:${t}` : null;
    }
    case "expenses":
    case "payment_promises": {
      const o = fk("order_id");
      if (o) return `order:${o}`;
      const p = fk("project_id");
      if (p) return `project:${p}`;
      const c = fk("customer_id");
      if (c) return `customer:${c}`;
      return null;
    }
    case "lease_agreements":
    case "property_expenses": {
      const p = fk("property_id");
      return p ? `property:${p}` : null;
    }
    // Shares the parent expense's parentKey (same project_id) so it folds under
    // the "הוצאה" row it was created alongside, the same way order_items fold
    // under their order.
    case "project_expenses": {
      const p = fk("project_id");
      return p ? `project:${p}` : null;
    }
    case "contacts":
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

// A list page opened AT one specific row. The app shell's FocusHighlighter reads
// `?focus=<id>` and scrolls to / flashes the element carrying
// `data-focus-id="<id>"`, so clicking an activity row lands on the record it
// describes instead of the top of the section. A page that hasn't opted in just
// ignores the param, so this is always safe to add.
export function buildFocusHref(path: string, id: string | null | undefined): string {
  if (!id) return path;
  return `${path}${path.includes("?") ? "&" : "?"}focus=${encodeURIComponent(id)}`;
}

// Where clicking the row should go. Prefers the parent entity (an order/project/
// customer has its own page), then the record's own destination — always the
// exact record, never just the section it lives in. `data` is the row's
// new_data/old_data, needed for the tables whose target lives behind a foreign
// key (a document link points at its document, a movement at its product…).
export function buildHref(
  tableName: string,
  recordId: string,
  parentKey: string | null,
  data: Record<string, AuditLogValue> | null = null
): string | null {
  const fromParent = hrefFromParentKey(parentKey);
  if (fromParent) return fromParent;
  const fk = (key: string): string | null => {
    const v = data?.[key];
    return typeof v === "string" && v ? v : null;
  };
  switch (tableName) {
    case "tasks": return `/tasks/${recordId}`;
    case "users": return `/payroll/workers/${recordId}`;
    // Login/logout ("נכנס" / "יצא") have nowhere meaningful to go — the event IS
    // the record. Null keeps the row non-clickable (and un-hovered) rather than
    // dumping the reader on a payroll page they didn't ask for.
    case "auth": return null;
    case "documents": return buildFocusHref("/documents", recordId);
    // A document attached to something with no page of its own (a task, a
    // worker's session…) — open the file itself in the archive.
    case "document_links": return buildFocusHref("/documents", fk("document_id"));
    case "vehicles": return `/vehicles/${recordId}`;
    case "properties": return "/properties";
    case "products":
    case "product_categories": return buildFocusHref("/sales?tab=inventory", recordId);
    case "inventory_movements": return buildFocusHref("/sales?tab=inventory", fk("product_id"));
    // The cash-flow rows are keyed "<kind>:<uuid>" (see lib/financial/entries.ts).
    case "expenses": return buildFocusHref("/financial", `expense:${recordId}`);
    case "payments": return buildFocusHref("/financial", `payment:${recordId}`);
    case "recurring_expense_templates":
    case "accounts": return "/financial";
    // A transfer only exists inside the accounts register.
    case "account_transfers": return "/financial/bank";
    // An installment shows up in the calendar under its parent expense's entry id.
    case "expense_installments": {
      const e = fk("expense_id");
      return buildFocusHref("/financial/payments-calendar", e ? `expense:${e}` : null);
    }
    case "loans": return `/financial/loans/${recordId}`;
    case "loan_repayments": {
      const loanId = fk("loan_id");
      return loanId ? `/financial/loans/${loanId}` : "/financial/loans";
    }
    case "card_statements": return `/financial/statements/${recordId}`;
    case "worker_payments":
    case "worker_payment_allocations":
    case "salary_agreements":
    case "payroll_periods":
    case "payslips":
    case "payslip_items":
    case "worker_absences":
    case "hourly_salary_overrides": return "/payroll";
    case "phone_attendance_reports": return "/payroll/attendance";
    case "recurring_task_templates":
    case "recurring_task_template_assignees": return "/tasks/recurring";
    case "payment_promises":
    case "dunning_stages": return "/collections";
    case "lease_agreements":
    case "property_expenses": {
      const p = fk("property_id");
      return p ? `/properties/${p}` : "/properties";
    }
    // No page of their own, but a row should never be a dead end — send it to
    // the screen that owns the record.
    case "tags": return "/vehicles";
    case "reminders": return "/inbox";
    case "communications":
    case "communication_logs":
    case "inquiries": return "/communications";
    case "morning_documents": return "/invoices";
    case "morning_settings": return "/settings/integrations/morning";
    case "business_settings":
    case "push_alert_config":
    case "fcm_tokens":
    case "push_subscriptions": return "/settings";
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
  const propertyIds = new Set<string>();
  const userIds = new Set<string>();
  const orderIds = new Set<string>(); // resolved one hop further → their customer
  const workerPaymentIds = new Set<string>(); // resolved one hop further → their worker
  const loanIds = new Set<string>(); // resolved one hop further → their counterparty
  const payslipIds = new Set<string>(); // resolved one hop further → their worker

  for (const r of rows) {
    const d = dataOf(r);
    switch (r.table_name) {
      case "orders": {
        const c = fk(d, "customer_id");
        if (c) customerIds.add(c);
        break;
      }
      case "loans": {
        const c = fk(d, "counterparty_customer_id");
        if (c) customerIds.add(c);
        break;
      }
      case "loan_repayments": {
        const l = fk(d, "loan_id");
        if (l) loanIds.add(l);
        break;
      }
      case "payment_promises": {
        const c = fk(d, "customer_id");
        if (c) customerIds.add(c);
        const p = fk(d, "project_id");
        if (p) projectIds.add(p);
        const o = fk(d, "order_id");
        if (o) orderIds.add(o);
        break;
      }
      case "lease_agreements":
      case "property_expenses": {
        const p = fk(d, "property_id");
        if (p) propertyIds.add(p);
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
      case "attendance_sessions":
      case "phone_attendance_reports":
      case "worker_absences":
      case "recurring_task_template_assignees":
      case "payslips": {
        const u = fk(d, "user_id");
        if (u) userIds.add(u);
        break;
      }
      // No user_id on this table — only worker_payment_id — so the worker's
      // name needs the same one-hop resolution as order_items → orders.
      case "worker_payment_allocations": {
        const wp = fk(d, "worker_payment_id");
        if (wp) workerPaymentIds.add(wp);
        break;
      }
      // Same shape: only payslip_id lives here, the worker is one hop away.
      case "payslip_items": {
        const p = fk(d, "payslip_id");
        if (p) payslipIds.add(p);
        break;
      }
      case "expenses":
      case "project_expenses": {
        const p = fk(d, "project_id");
        if (p) projectIds.add(p);
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

  // Three one-hop lookups, each keyed off ids gathered from the original `rows`
  // pass above and none reading the others' output — run them concurrently
  // instead of one after another.
  const [orderHopRes, loanHopRes, workerPaymentHopRes, payslipHopRes] = await Promise.all([
    orderIds.size > 0
      ? supabase.from("orders").select("id,customer_id").in("id", Array.from(orderIds))
      : Promise.resolve({ data: [] as { id?: string; customer_id?: string }[] }),
    loanIds.size > 0
      ? supabase
          .from("loans")
          .select("id,counterparty_customer_id,lender,borrower")
          .in("id", Array.from(loanIds))
      : Promise.resolve({
          data: [] as { id?: string; counterparty_customer_id?: string; lender?: string; borrower?: string }[],
        }),
    workerPaymentIds.size > 0
      ? supabase.from("worker_payments").select("id,user_id").in("id", Array.from(workerPaymentIds))
      : Promise.resolve({ data: [] as { id?: string; user_id?: string }[] }),
    payslipIds.size > 0
      ? supabase.from("payslips").select("id,user_id").in("id", Array.from(payslipIds))
      : Promise.resolve({ data: [] as { id?: string; user_id?: string }[] }),
  ]);

  // First hop: order → its customer (so an order/payment shows the buyer's name).
  const orderCustomer = new Map<string, string>();
  for (const row of (orderHopRes.data ?? []) as { id?: string; customer_id?: string }[]) {
    if (typeof row.id === "string" && typeof row.customer_id === "string") {
      orderCustomer.set(row.id, row.customer_id);
      customerIds.add(row.customer_id);
    }
  }

  // First hop: loan_repayments → its loan → who the loan is with (customer, or
  // just the free-text lender/borrower field if it isn't linked to a customer).
  const loanCounterparty = new Map<string, { customerId: string | null; text: string | null }>();
  for (const row of (loanHopRes.data ?? []) as {
    id?: string;
    counterparty_customer_id?: string;
    lender?: string;
    borrower?: string;
  }[]) {
    if (typeof row.id !== "string") continue;
    const customerId = typeof row.counterparty_customer_id === "string" ? row.counterparty_customer_id : null;
    if (customerId) customerIds.add(customerId);
    const text = (row.lender || row.borrower || "").trim() || null;
    loanCounterparty.set(row.id, { customerId, text });
  }

  // First hop: worker_payment_allocations → its worker_payments row → the worker.
  const workerPaymentUser = new Map<string, string>();
  for (const row of (workerPaymentHopRes.data ?? []) as { id?: string; user_id?: string }[]) {
    if (typeof row.id === "string" && typeof row.user_id === "string") {
      workerPaymentUser.set(row.id, row.user_id);
      userIds.add(row.user_id);
    }
  }

  // First hop: payslip_items → its payslips row → the worker.
  const payslipUser = new Map<string, string>();
  for (const row of (payslipHopRes.data ?? []) as { id?: string; user_id?: string }[]) {
    if (typeof row.id === "string" && typeof row.user_id === "string") {
      payslipUser.set(row.id, row.user_id);
      userIds.add(row.user_id);
    }
  }

  const [customerRes, projectRes, propertyRes, userNames] = await Promise.all([
    customerIds.size > 0
      ? supabase.from("customers").select("id,name").in("id", Array.from(customerIds))
      : Promise.resolve({ data: [] as NamedRow[] }),
    projectIds.size > 0
      ? supabase.from("projects").select("id,name").in("id", Array.from(projectIds))
      : Promise.resolve({ data: [] as NamedRow[] }),
    propertyIds.size > 0
      ? supabase.from("properties").select("id,name,address").in("id", Array.from(propertyIds))
      : Promise.resolve({ data: [] as { id?: string; name?: string; address?: string }[] }),
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
  const propertyName = new Map<string, string>();
  for (const row of (propertyRes.data ?? []) as { id?: string; name?: string; address?: string }[]) {
    if (typeof row.id !== "string") continue;
    const label = (row.name ?? row.address ?? "").trim();
    if (label) propertyName.set(row.id, label);
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
      case "recurring_task_templates":
        title = inline(d, "subject_template");
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
      case "loans": {
        const c = fk(d, "counterparty_customer_id");
        title = (c ? customerName.get(c) ?? null : null) ?? inline(d, "lender") ?? inline(d, "borrower");
        break;
      }
      case "loan_repayments": {
        const l = fk(d, "loan_id");
        const counterparty = l ? loanCounterparty.get(l) : null;
        title =
          (counterparty?.customerId ? customerName.get(counterparty.customerId) ?? null : null) ??
          counterparty?.text ??
          null;
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
      case "attendance_sessions":
      case "phone_attendance_reports":
      case "worker_absences":
      case "recurring_task_template_assignees":
      case "payslips": {
        const u = fk(d, "user_id");
        title = u ? userNames[u] ?? null : null;
        break;
      }
      case "worker_payment_allocations": {
        const wp = fk(d, "worker_payment_id");
        const u = wp ? workerPaymentUser.get(wp) : null;
        title = u ? userNames[u] ?? null : null;
        break;
      }
      case "payslip_items": {
        const p = fk(d, "payslip_id");
        const u = p ? payslipUser.get(p) : null;
        title = u ? userNames[u] ?? null : null;
        break;
      }
      case "expenses":
      case "project_expenses": {
        const p = fk(d, "project_id");
        title = p ? projectName.get(p) ?? null : null;
        break;
      }
      case "payment_promises": {
        const c = fk(d, "customer_id");
        title =
          (c ? customerName.get(c) ?? null : null) ??
          customerOfOrder(fk(d, "order_id")) ??
          (() => {
            const p = fk(d, "project_id");
            return p ? projectName.get(p) ?? null : null;
          })();
        break;
      }
      case "lease_agreements":
      case "property_expenses": {
        const p = fk(d, "property_id");
        title = p ? propertyName.get(p) ?? null : null;
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
  approved: "אושר", rejected: "נדחה", sent: "נשלח", overdue: "באיחור", pending_review: "ממתין לאישור",
  issued: "הונפק", needs_invoice: "דורש חשבונית", scheduled: "מתוזמן",
  failed: "נכשל", success: "הצליח", contacted: "נוצר קשר", promised: "הובטח",
  // payment methods
  cash: "מזומן", credit: "אשראי", credit_card: "אשראי", card: "אשראי",
  check: "צ׳ק", cheque: "צ׳ק", bank_transfer: "העברה בנקאית", transfer: "העברה",
  bit: "ביט", paybox: "פייבוקס", other: "אחר",
  // booleans (needs_invoice, is_official, …)
  true: "כן", false: "לא",
};

const ABSENCE_TYPE_LABELS: Record<string, string> = {
  day_off: "יום חופש", vacation: "חופשה", sick: "מחלה",
  holiday: "חג", unpaid: "ללא תשלום", other: "אחר",
};

// Mirrors PAYSLIP_ITEM_TYPES in app/(app)/payroll/SalaryCenterUi.tsx — kept as a
// separate copy since that file is component-side and this one isn't.
const PAYSLIP_ITEM_TYPE_LABELS: Record<string, string> = {
  bonus: "בונוס", overtime_extra: "תוספת שעות נוספות", travel_allowance: "דמי נסיעה",
  meal_allowance: "דמי אוכל", advance: "מקדמה", deduction: "ניכוי",
  exception_absence: "היעדרות", exception_partial_month: "חודש חלקי",
  manual_adjustment: "התאמה ידנית",
};

function formatChangeValue(field: string, value: AuditLogValue): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "amount" || field.endsWith("_price") || field.endsWith("_amount")) {
    const n = Number(value);
    if (Number.isFinite(n)) return `₪${n.toLocaleString("he-IL")}`;
  }
  if (field.endsWith("_date") && typeof value === "string") {
    return formatShortDate(value, value);
  }
  const s = String(value);
  return STATUS_VALUE_LABELS[s] ?? s;
}

function isUpdateAction(action: string): boolean {
  return action === "update" || action === "UPDATE" || action === "status_changed" || action === "priority_changed";
}

// `notes` doubles as an append-only comment log on some tables (see
// lib/orders/comments.ts): every edit appends a new "<author> · <date>\n<body>"
// block onto the existing text, so `before` is a near-total prefix of `after`.
// Diffing it like any other field would print that whole accumulated blob
// twice (once as "before", once as "after") — this shows only what actually
// changed instead.
function buildNotesChange(before: string, after: string): AuditChange {
  const label = CHANGE_FIELD_LABELS.notes;
  if (after.startsWith(before) && before.length > 0) {
    const added = after.slice(before.length);
    const block = added.startsWith(ORDER_NOTES_SEPARATOR) ? added.slice(ORDER_NOTES_SEPARATOR.length) : added.replace(/^\n+/, "");
    return { label, before: "(ללא שינוי בהיסטוריה הקודמת)", after: block || formatChangeValue("notes", after) };
  }
  if (before.startsWith(after) && after.length > 0) {
    const removed = before.slice(after.length);
    const block = removed.startsWith(ORDER_NOTES_SEPARATOR) ? removed.slice(ORDER_NOTES_SEPARATOR.length) : removed.replace(/^\n+/, "");
    return { label, before: block || formatChangeValue("notes", before), after: "(ללא שינוי בהיסטוריה הקודמת)" };
  }
  return { label, before: formatChangeValue("notes", before), after: formatChangeValue("notes", after) };
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
    const change: AuditChange =
      field === "notes" && typeof before === "string" && typeof after === "string"
        ? buildNotesChange(before, after)
        : {
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

// Spelled out ("מ-X ל-Y") rather than "X → Y": a bare arrow glyph sitting in
// Hebrew RTL text is a bidi neutral character, so browsers can mirror or
// reorder it — the transition can end up visually pointing the wrong way.
// Words carry the direction unambiguously regardless of font/browser bidi
// handling.
function changeListToString(changes: AuditChange[]): string {
  return changes.map((c) => `${c.label}: מ-${c.before} ל-${c.after}`).join(" · ");
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
  // DELETE rows only ever carry old_data (see log_changes() — new_data is never
  // written on delete), so fall back to it or a deleted row's details column
  // would always be blank.
  const base = buildDetails(row.table_name, row.new_data ?? row.old_data ?? null);
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
  // Deletes carry their foreign keys in old_data only.
  const data = recordData(row.new_data ?? null, row.old_data ?? null);

  return {
    id: row.id,
    tableName: row.table_name,
    recordId: row.record_id,
    action: row.action,
    actionLabel: actionLabel(row.action),
    entityLabel: entityLabel(row.table_name, data),
    summary: buildSummary(row.table_name, row.action, data),
    details,
    baseDetails: base,
    changes,
    actorName: row.changed_by ? actorName ?? "משתמש" : "מערכת",
    actorRole: row.user_role,
    actorColor: row.changed_by ? actorColor : null,
    createdAt: row.created_at,
    title,
    parentKey,
    href: buildHref(row.table_name, row.record_id, parentKey, data),
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
  // trg_audit_account_transfers (migration 20260805000000_account_transfers.sql).
  "account_transfers",
  // trg_audit_card_account_mappings / trg_audit_card_statement_charges
  // (migration 20260830120000_card_statement_charges.sql).
  "card_account_mappings",
  "card_statement_charges",
  // Found 2026-09-01 while auditing routes for the hybrid-direct-supabase
  // initiative: all 3 had the generic trg_audit_* trigger attached (confirmed
  // via 20260825120000_close_audit_coverage_drift.sql's own comment for the
  // first two, and payslip_items existing since the baseline with a uuid PK
  // and no denylist entry) but were missing here — every logAuditEvent call
  // on these tables had been double-logging into audit_logs since each table
  // was created. Exact same drift class as the notifications/phone_attendance
  // fixes already documented above; this list is hand-maintained and the DB
  // attach-loop isn't, so they silently diverge unless checked explicitly.
  "phone_attendance_reports",
  "worker_absences",
  "payslip_items",
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
  { value: "phone_attendance_reports", label: "דיווחי נוכחות טלפוניים" },
  { value: "worker_absences", label: "ימי חופש" },
  { value: "recurring_task_templates", label: "משימות קבועות" },
  { value: "payment_promises", label: "הבטחות תשלום" },
  { value: "lease_agreements", label: "הסכמי שכירות" },
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
  { value: "login", label: "כניסה למערכת" },
  { value: "logout", label: "יציאה מהמערכת" },
] as const;

function formatDurationHe(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return "פחות מדקה";
  if (min < 60) return `${min} דק'`;
  const hrs = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${hrs} שע' ${rem} דק'` : `${hrs} שע'`;
}

// For each 'יצא' (logout) row, fill in how long the person was actually active.
// auth rows store the user's users.id in record_id, and both sides are written
// app-side, so we pair by it. A 'נכנס' row deliberately carries NO duration —
// the length belongs on the row that ENDS the visit, not on the one that starts it.
// Mutates the passed items; a no-op (no query) when the page has no logout rows.
//
// The duration is NOT the raw login→logout wall-clock gap — that also counts
// however long the app just sat open and unused (a phone left in a pocket for
// days shows up as "was active 94h"). Instead it's built from user_sessions,
// whose last_seen_at only advances via a heartbeat sent while the tab/screen is
// actually visible (PresenceTracker skips the heartbeat when hidden) — so
// started_at→last_seen_at is a real "was actually active" span. Falls back to
// the raw login/logout gap when no session rows cover that visit (tracking
// wasn't live yet for old rows, or the migration hasn't run).
async function enrichLogoutDurations(
  supabase: SupabaseClient,
  items: AuditFeedItem[]
): Promise<void> {
  const logouts = items.filter(
    (i) => i.tableName === "auth" && i.action === "logout" && i.createdAt && i.recordId
  );
  if (logouts.length === 0) return;

  const userIds = Array.from(new Set(logouts.map((i) => i.recordId)));
  const times = logouts
    .map((i) => new Date(i.createdAt as string).getTime())
    .filter((t) => !Number.isNaN(t));
  // Anchor to this PAGE's window — the newest-first 1000-row cap would otherwise
  // return only recent logins and match nothing on a page of older rows.
  const newestLogout = times.length ? Math.max(...times) : Date.now();

  const { data } = await supabase
    .from("audit_logs")
    .select("record_id,created_at")
    .eq("table_name", "auth")
    .eq("action", "login")
    .in("record_id", userIds)
    .lte("created_at", new Date(newestLogout).toISOString())
    .order("created_at", { ascending: false })
    .range(0, 999);

  const loginsByUser = new Map<string, number[]>();
  for (const r of (data ?? []) as unknown as Array<{ record_id?: string; created_at?: string }>) {
    if (typeof r.record_id !== "string" || typeof r.created_at !== "string") continue;
    const t = new Date(r.created_at).getTime();
    if (Number.isNaN(t)) continue;
    const arr = loginsByUser.get(r.record_id) ?? [];
    arr.push(t); // already newest-first from the query order
    loginsByUser.set(r.record_id, arr);
  }

  const priorByLogoutId = new Map<string, number>();
  let oldestPrior = newestLogout;
  for (const item of logouts) {
    const logoutT = new Date(item.createdAt as string).getTime();
    const prior = (loginsByUser.get(item.recordId) ?? []).find((t) => t < logoutT);
    if (prior === undefined) continue;
    priorByLogoutId.set(item.id, prior);
    if (prior < oldestPrior) oldestPrior = prior;
  }

  const { data: sessionData } = await supabase
    .from("user_sessions")
    .select("user_id,started_at,last_seen_at")
    .in("user_id", userIds)
    .gte("last_seen_at", new Date(oldestPrior).toISOString())
    .lte("started_at", new Date(newestLogout).toISOString())
    .range(0, 1999);

  const sessionsByUser = new Map<string, Array<{ start: number; seen: number }>>();
  for (const r of (sessionData ?? []) as unknown as Array<{
    user_id?: string;
    started_at?: string;
    last_seen_at?: string;
  }>) {
    if (
      typeof r.user_id !== "string" ||
      typeof r.started_at !== "string" ||
      typeof r.last_seen_at !== "string"
    )
      continue;
    const start = new Date(r.started_at).getTime();
    const seen = new Date(r.last_seen_at).getTime();
    if (Number.isNaN(start) || Number.isNaN(seen)) continue;
    const arr = sessionsByUser.get(r.user_id) ?? [];
    arr.push({ start, seen });
    sessionsByUser.set(r.user_id, arr);
  }

  for (const item of logouts) {
    const prior = priorByLogoutId.get(item.id);
    if (prior === undefined) continue;
    const logoutT = new Date(item.createdAt as string).getTime();

    // Only sessions (tabs) whose heartbeat window overlaps this visit.
    const sessions = (sessionsByUser.get(item.recordId) ?? []).filter(
      (s) => s.start <= logoutT && s.seen >= prior
    );
    const activeMs = sessions.length
      ? Math.max(...sessions.map((s) => Math.min(s.seen, logoutT))) -
        Math.min(...sessions.map((s) => Math.max(s.start, prior)))
      : logoutT - prior; // no session rows for this visit — fall back to the raw gap

    const label = `היה פעיל ${formatDurationHe(Math.max(activeMs, 0))}`;
    item.baseDetails = item.baseDetails ? `${label} · ${item.baseDetails}` : label;
    item.details = item.details ? `${label} · ${item.details}` : label;
  }
}

const DOCUMENT_LINK_TYPE_LABELS: Record<string, string> = {
  customer: "לקוח",
  project: "פרויקט",
  order: "הזמנה",
  property: "נכס",
  task: "משימה",
  loan: "הלוואה",
  expense: "הוצאה",
  payment: "תשלום",
  user: "משתמש",
  session: "משמרת",
};

// A document row's own details would otherwise just repeat the file name (already
// shown as the row's title) — so instead say what the upload is actually attached
// to (an order/project/customer/…), which is stored on a separate document_links
// row and can't be read off the document row alone. Mutates the passed items; a
// no-op (no query) when the page has no document rows.
export async function enrichDocumentLinks(supabase: SupabaseClient, items: AuditFeedItem[]): Promise<void> {
  const docItems = items.filter((i) => i.tableName === "documents" && i.recordId);
  if (docItems.length === 0) return;

  const documentIds = Array.from(new Set(docItems.map((i) => i.recordId)));
  const { data } = await supabase
    .from("document_links")
    .select("document_id,entity_type,entity_id")
    .in("document_id", documentIds);
  const links = (data ?? []) as { document_id?: string; entity_type?: string; entity_id?: string }[];
  if (links.length === 0) return;

  // One link per document is the common case; keep the first if there are several.
  const linkByDocument = new Map<string, { type: string; id: string }>();
  for (const l of links) {
    if (
      typeof l.document_id === "string" &&
      typeof l.entity_type === "string" &&
      typeof l.entity_id === "string" &&
      !linkByDocument.has(l.document_id)
    ) {
      linkByDocument.set(l.document_id, { type: l.entity_type, id: l.entity_id });
    }
  }

  // A deleted document's document_links row is gone too (ON DELETE CASCADE), so
  // the live-table lookup above finds nothing for it — a deleted document would
  // otherwise show only its bare file name with no "what was it attached to"
  // context. The cascade delete still logged its OWN audit_logs row (old_data
  // has the entity it pointed at) — recover the link from there.
  const deletedDocIds = docItems
    .filter((i) => (i.action === "delete" || i.action === "DELETE") && !linkByDocument.has(i.recordId))
    .map((i) => i.recordId)
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (deletedDocIds.length > 0) {
    const { data: histData } = await supabase
      .from("audit_logs")
      .select("old_data")
      .eq("table_name", "document_links")
      .in("action", ["delete", "DELETE"])
      .in("old_data->>document_id", Array.from(new Set(deletedDocIds)))
      .order("created_at", { ascending: false })
      .range(0, 999);
    for (const row of (histData ?? []) as { old_data?: Record<string, unknown> }[]) {
      const od = row.old_data;
      const docId = od?.document_id;
      const entityType = od?.entity_type;
      const entityId = od?.entity_id;
      if (
        typeof docId === "string" &&
        typeof entityType === "string" &&
        typeof entityId === "string" &&
        !linkByDocument.has(docId)
      ) {
        linkByDocument.set(docId, { type: entityType, id: entityId });
      }
    }
  }

  if (linkByDocument.size === 0) return;

  const customerIds = new Set<string>();
  const projectIds = new Set<string>();
  const orderIds = new Set<string>();
  const taskIds = new Set<string>();
  const propertyIds = new Set<string>();
  for (const { type, id } of linkByDocument.values()) {
    if (type === "customer") customerIds.add(id);
    else if (type === "project") projectIds.add(id);
    else if (type === "order") orderIds.add(id);
    else if (type === "task") taskIds.add(id);
    else if (type === "property") propertyIds.add(id);
  }

  // Orders don't carry a display name of their own — resolve one hop further to
  // the buyer, same as resolveAuditTitles does for order-anchored rows.
  const orderCustomer = new Map<string, string>();
  if (orderIds.size > 0) {
    const { data: orderRows } = await supabase.from("orders").select("id,customer_id").in("id", Array.from(orderIds));
    for (const row of (orderRows ?? []) as { id?: string; customer_id?: string }[]) {
      if (typeof row.id === "string" && typeof row.customer_id === "string") {
        orderCustomer.set(row.id, row.customer_id);
        customerIds.add(row.customer_id);
      }
    }
  }

  const [customerRes, projectRes, taskRes, propertyRes] = await Promise.all([
    customerIds.size > 0
      ? supabase.from("customers").select("id,name").in("id", Array.from(customerIds))
      : Promise.resolve({ data: [] as NamedRow[] }),
    projectIds.size > 0
      ? supabase.from("projects").select("id,name").in("id", Array.from(projectIds))
      : Promise.resolve({ data: [] as NamedRow[] }),
    taskIds.size > 0
      ? supabase.from("tasks").select("id,subject").in("id", Array.from(taskIds))
      : Promise.resolve({ data: [] as { id?: string; subject?: string }[] }),
    propertyIds.size > 0
      ? supabase.from("properties").select("id,name,address").in("id", Array.from(propertyIds))
      : Promise.resolve({ data: [] as { id?: string; name?: string; address?: string }[] }),
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
  const taskName = new Map<string, string>();
  for (const row of (taskRes.data ?? []) as { id?: string; subject?: string }[]) {
    if (typeof row.id === "string" && typeof row.subject === "string" && row.subject.trim()) {
      taskName.set(row.id, row.subject.trim());
    }
  }
  const propertyName = new Map<string, string>();
  for (const row of (propertyRes.data ?? []) as { id?: string; name?: string; address?: string }[]) {
    if (typeof row.id !== "string") continue;
    const label = (row.name ?? row.address ?? "").trim();
    if (label) propertyName.set(row.id, label);
  }

  const nameFor = (type: string, id: string): string | null => {
    switch (type) {
      case "customer": return customerName.get(id) ?? null;
      case "project": return projectName.get(id) ?? null;
      case "task": return taskName.get(id) ?? null;
      case "property": return propertyName.get(id) ?? null;
      case "order": {
        const c = orderCustomer.get(id);
        return c ? customerName.get(c) ?? null : null;
      }
      default: return null;
    }
  };

  for (const item of docItems) {
    const link = linkByDocument.get(item.recordId);
    if (!link) continue;
    const typeLabel = DOCUMENT_LINK_TYPE_LABELS[link.type] ?? link.type;
    const name = nameFor(link.type, link.id);
    const label = name ? `שייך ל${typeLabel}: ${name}` : `שייך ל${typeLabel}`;
    item.baseDetails = label;
    item.details = label;
  }
}

// An order row's "סטטוס: X" field-diff chips aren't what a buyer (or the feed
// reader) actually wants to know — they think in "what's in this order", not
// field names. Replace the base amount + status changes with a compact
// "item ×qty, item ×qty … · סה"כ ₪N" line, same convention as the WhatsApp/
// print order summary in OrderShareActions. Mutates the passed items; a no-op
// when the page has no order rows or an order currently has no line items
// (e.g. it was deleted and its items cascaded away).
async function enrichOrderItemsSummary(supabase: SupabaseClient, items: AuditFeedItem[]): Promise<void> {
  const orderItems = items.filter((i) => i.tableName === "orders" && i.recordId);
  if (orderItems.length === 0) return;

  const orderIds = Array.from(new Set(orderItems.map((i) => i.recordId)));
  const { data } = await supabase
    .from("order_items")
    .select("order_id,product_id,description,quantity_ordered")
    .in("order_id", orderIds);
  const rows = (data ?? []) as {
    order_id?: string;
    product_id?: string;
    description?: string;
    quantity_ordered?: number;
  }[];
  if (rows.length === 0) return;

  const productIds = Array.from(
    new Set(rows.map((r) => r.product_id).filter((v): v is string => typeof v === "string" && Boolean(v)))
  );
  const productName = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: productRows } = await supabase.from("products").select("id,name").in("id", productIds);
    for (const p of (productRows ?? []) as { id?: string; name?: string }[]) {
      if (typeof p.id === "string" && typeof p.name === "string" && p.name.trim()) {
        productName.set(p.id, p.name.trim());
      }
    }
  }

  const byOrder = new Map<string, { name: string; quantity: number }[]>();
  for (const r of rows) {
    if (typeof r.order_id !== "string") continue;
    const name =
      (typeof r.product_id === "string" ? productName.get(r.product_id) : null) ??
      ((typeof r.description === "string" ? r.description.trim() : "") || "פריט");
    const quantity = Number(r.quantity_ordered) || 0;
    const list = byOrder.get(r.order_id) ?? [];
    list.push({ name, quantity });
    byOrder.set(r.order_id, list);
  }

  // Keep each card short: name a few items and fold the rest into a count
  // rather than listing everything (an order can carry a dozen-plus lines).
  const ITEMS_SHOWN = 3;
  for (const item of orderItems) {
    const list = byOrder.get(item.recordId);
    if (!list || list.length === 0) continue;
    const shown = list.slice(0, ITEMS_SHOWN).map((i) => `${i.name} ×${i.quantity}`).join(", ");
    const rest = list.length - ITEMS_SHOWN;
    const itemsPart = rest > 0 ? `${shown} ועוד ${rest}` : shown;
    const summary = item.baseDetails ? `${itemsPart} · סה"כ ${item.baseDetails}` : itemsPart;
    item.baseDetails = summary;
    item.details = summary;
    item.changes = [];
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
  await Promise.all([
    enrichLogoutDurations(supabase, items),
    enrichDocumentLinks(supabase, items),
    enrichOrderItemsSummary(supabase, items),
  ]);

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
