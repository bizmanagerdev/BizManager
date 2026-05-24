import type { SupabaseClient } from "@supabase/supabase-js";

type AuditLogPrimitive = string | number | boolean | null;
type AuditLogValue = AuditLogPrimitive | AuditLogValue[] | { [key: string]: AuditLogValue };

type AuditLogRow = {
  id: string;
  table_name: string;
  record_id: string;
  action: string;
  changed_by: string | null;
  user_role: string | null;
  created_at: string | null;
  new_data?: AuditLogValue;
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
    case "inquiries": return "פנייה";
    case "morning_documents": return "מסמך Morning";
    case "morning_settings": return "הגדרות Morning";
    default: return tableName;
  }
}

function actionLabel(action: string) {
  switch (action) {
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

function buildDetails(tableName: string, newData: AuditLogValue): string {
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
  }

  return parts.join(" · ");
}

function buildSummary(tableName: string, action: string) {
  return `${entityLabel(tableName)} ${actionLabel(action)}`;
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

function normalizeAuditRows(rows: AuditLogRow[], actorNames: Map<string, string>): AuditFeedItem[] {
  return rows.map((row) => ({
    id: row.id,
    tableName: row.table_name,
    recordId: row.record_id,
    action: row.action,
    actionLabel: actionLabel(row.action),
    entityLabel: entityLabel(row.table_name),
    summary: buildSummary(row.table_name, row.action),
    details: buildDetails(row.table_name, row.new_data ?? null),
    actorName: row.changed_by ? actorNames.get(row.changed_by) ?? "משתמש" : "מערכת",
    actorRole: row.user_role,
    createdAt: row.created_at,
  }));
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
      error: error.message,
    });
  }
}

export async function getRecentAuditEvents(supabase: SupabaseClient, limit = 8) {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id,table_name,record_id,action,changed_by,user_role,created_at,new_data")
    .order("created_at", { ascending: false })
    .range(0, Math.max(limit - 1, 0));

  if (error) {
    return { items: [] as AuditFeedItem[], error: error.message };
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
    .select("id,table_name,record_id,action,changed_by,user_role,created_at,new_data")
    .eq("table_name", tableName)
    .in("record_id", recordIds)
    .order("created_at", { ascending: false });

  if (actions && actions.length > 0) {
    query = query.in("action", actions);
  }

  const { data, error } = await query.range(0, rowLimit - 1);

  if (error) {
    return { byRecordId: {} as Record<string, AuditRecordInfo>, error: error.message };
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
] as const;

export const AUDIT_ACTION_OPTIONS = [
  { value: "", label: "כל הפעולות" },
  { value: "create", label: "יצירה" },
  { value: "update", label: "עדכון" },
  { value: "delete", label: "מחיקה" },
  { value: "status_changed", label: "שינוי סטטוס" },
  { value: "upload", label: "העלאה" },
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
    .select("id,table_name,record_id,action,changed_by,user_role,created_at,new_data", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + AUDIT_PAGE_SIZE - 1);

  if (tableName) query = query.eq("table_name", tableName);
  if (action) query = query.eq("action", action);

  const { data, error, count } = await query;

  if (error) {
    return { items: [] as AuditFeedItem[], totalCount: 0, page: safePage, totalPages: 1, error: error.message };
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
