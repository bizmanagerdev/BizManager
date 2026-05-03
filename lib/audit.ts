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
  actorName: string;
  actorRole: string | null;
  createdAt: string | null;
};

export type AuditRecordInfo = {
  action: string;
  actionLabel: string;
  entityLabel: string;
  summary: string;
  actorName: string;
  actorRole: string | null;
  createdAt: string | null;
};

function entityLabel(tableName: string) {
  switch (tableName) {
    case "projects":
      return "פרויקט";
    case "tasks":
      return "משימה";
    case "expenses":
      return "הוצאה";
    case "payments":
      return "תשלום";
    case "documents":
      return "מסמך";
    default:
      return tableName;
  }
}

function actionLabel(action: string) {
  switch (action) {
    case "create":
      return "נוצר";
    case "update":
      return "עודכן";
    case "delete":
      return "נמחק";
    case "status_changed":
      return "סטטוס עודכן";
    case "priority_changed":
      return "עדיפות עודכנה";
    case "upload":
      return "הועלה";
    default:
      return action;
  }
}

function buildSummary(tableName: string, action: string) {
  return `${entityLabel(tableName)} ${actionLabel(action)}`;
}

function actorDisplayName(actor: AuditActorRow) {
  return typeof actor.full_name === "string" && actor.full_name.trim()
    ? actor.full_name.trim()
    : typeof actor.email === "string" && actor.email.trim()
      ? actor.email.trim()
      : "משתמש";
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
    if (typeof row.id === "string" && row.id) map[row.id] = displayName;
    if (typeof row.auth_user_id === "string" && row.auth_user_id) map[row.auth_user_id] = displayName;
  }

  return map;
}

async function getActorNames(supabase: SupabaseClient, actorIds: string[]) {
  if (actorIds.length === 0) return new Map<string, string>();

  const { data, error } = await supabase
    .from("users")
    .select("id,full_name,email")
    .in("id", actorIds);

  if (error) {
    return new Map<string, string>();
  }

  const map = new Map<string, string>();
  for (const actor of (data ?? []) as AuditActorRow[]) {
    const name =
      typeof actor.full_name === "string" && actor.full_name.trim()
        ? actor.full_name.trim()
        : typeof actor.email === "string" && actor.email.trim()
          ? actor.email.trim()
          : "משתמש";
    map.set(actor.id, name);
  }
  return map;
}

function normalizeAuditRows(rows: AuditLogRow[], actorNames: Map<string, string>) {
  return rows.map((row) => ({
    id: row.id,
    tableName: row.table_name,
    recordId: row.record_id,
    action: row.action,
    actionLabel: actionLabel(row.action),
    entityLabel: entityLabel(row.table_name),
    summary: buildSummary(row.table_name, row.action),
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
    .select("id,table_name,record_id,action,changed_by,user_role,created_at")
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
  }: {
    tableName: string;
    recordIds: string[];
  }
) {
  if (recordIds.length === 0) {
    return { byRecordId: {} as Record<string, AuditRecordInfo>, error: null as string | null };
  }

  const rowLimit = Math.min(Math.max(recordIds.length * 6, 50), 500);
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id,table_name,record_id,action,changed_by,user_role,created_at")
    .eq("table_name", tableName)
    .in("record_id", recordIds)
    .order("created_at", { ascending: false })
    .range(0, rowLimit - 1);

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
