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

export type AuditFeedItem = {
  id: string;
  tableName: string;
  recordId: string;
  action: string;
  actionLabel: string;
  entityLabel: string;
  summary: string;
  details: string;
  actorName: string;
  actorRole: string | null;
  createdAt: string | null;
};

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
    case "inquiries": return "פנייה";
    case "recurring_expense_templates": return "הוצאה קבועה";
    case "recurring_task_templates": return "משימה קבועה";
    case "communications": return "תקשורת";
    case "morning_documents": return "מסמך Morning";
    case "morning_settings": return "הגדרות Morning";
    case "auth": return "מערכת";
    default: return tableName;
  }
}

export function actionLabel(action: string) {
  switch (action) {
    case "login":
      return "התחבר";
    case "logout":
      return "התנתק";
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
  }

  return parts.join(" · ");
}

export function buildSummary(tableName: string, action: string) {
  return `${entityLabel(tableName)} ${actionLabel(action)}`;
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
  notes: "הערות",
};

// Order controls how changes are listed; first matches win.
const CHANGE_FIELDS = Object.keys(CHANGE_FIELD_LABELS);

// Masculine, project-wide (see feedback-hebrew-gender-agreement).
const STATUS_VALUE_LABELS: Record<string, string> = {
  open: "פתוח", closed: "סגור", active: "פעיל", inactive: "לא פעיל",
  pending: "ממתין", in_progress: "בתהליך", completed: "הושלם", done: "הושלם",
  todo: "לביצוע", to_do: "לביצוע", blocked: "חסום", on_hold: "מושהה",
  cancelled: "בוטל", canceled: "בוטל", paid: "שולם", unpaid: "לא שולם",
  partial: "חלקי", draft: "טיוטה", new: "חדש", lost: "אבוד", won: "זכה",
  low: "נמוכה", medium: "בינונית", high: "גבוהה", urgent: "דחופה",
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

function buildChanges(oldData: AuditLogValue, newData: AuditLogValue): string {
  if (!oldData || typeof oldData !== "object" || Array.isArray(oldData)) return "";
  if (!newData || typeof newData !== "object" || Array.isArray(newData)) return "";
  const o = oldData as Record<string, AuditLogValue>;
  const n = newData as Record<string, AuditLogValue>;

  const parts: string[] = [];
  for (const field of CHANGE_FIELDS) {
    if (!(field in o) && !(field in n)) continue;
    const before = o[field] ?? null;
    const after = n[field] ?? null;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const part = `${CHANGE_FIELD_LABELS[field]}: ${formatChangeValue(field, before)} → ${formatChangeValue(field, after)}`;
    // Skip duplicates (e.g. agreed_base_price + actual_price both → "מחיר").
    if (parts.includes(part)) continue;
    parts.push(part);
    if (parts.length >= 3) break;
  }
  return parts.join(" · ");
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

export function buildAuditFeedItem(row: AuditLogRow, actorName: string | null): AuditFeedItem {
  const base = buildDetails(row.table_name, row.new_data ?? null);
  const changes = isUpdateAction(row.action)
    ? buildChanges(row.old_data ?? null, row.new_data ?? null)
    : "";
  const details = [base, changes].filter(Boolean).join(" · ");

  return {
    id: row.id,
    tableName: row.table_name,
    recordId: row.record_id,
    action: row.action,
    actionLabel: actionLabel(row.action),
    entityLabel: entityLabel(row.table_name),
    summary: buildSummary(row.table_name, row.action),
    details,
    actorName: row.changed_by ? actorName ?? "משתמש" : "מערכת",
    actorRole: row.user_role,
    createdAt: row.created_at,
  };
}

function normalizeAuditRows(rows: AuditLogRow[], actorNames: Map<string, string>): AuditFeedItem[] {
  return rows.map((row) =>
    buildAuditFeedItem(row, row.changed_by ? actorNames.get(row.changed_by) ?? null : null)
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
  const actorNames = await getActorNames(supabase, actorIds);

  return {
    items: normalizeAuditRows(rows, actorNames),
    error: null as string | null,
  };
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

export async function getAuditFeedPaginated(
  supabase: SupabaseClient,
  {
    page = 1,
    tableName,
    action,
  }: {
    page?: number;
    tableName?: string | null;
    action?: string | null;
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

  const { data, error, count } = await query;

  if (error) {
    return { items: [] as AuditFeedItem[], totalCount: 0, page: safePage, totalPages: 1, error: toHebrewError(error.message) };
  }

  const rows = (data ?? []) as AuditLogRow[];
  const actorIds = Array.from(
    new Set(rows.map((r) => r.changed_by).filter((v): v is string => typeof v === "string" && Boolean(v)))
  );
  const actorNames = await getActorNames(supabase, actorIds);
  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / AUDIT_PAGE_SIZE));

  return {
    items: normalizeAuditRows(rows, actorNames),
    totalCount,
    page: safePage,
    totalPages,
    error: null as string | null,
  };
}
