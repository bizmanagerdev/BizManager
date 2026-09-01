import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type EntityReminderRow = {
  id: string;
  remindAt: string;
  content: string | null;
  status: string;
  assignedTo: string | null;
  assignedToName: string | null;
  source: "manual" | "system";
  behavior: string;
  severity: string;
  notifiedAt: string | null;
};

type Row = Record<string, unknown>;
const s = (row: Row, key: string) => (typeof row[key] === "string" ? (row[key] as string) : null);

/**
 * Every reminder attached to one entity (order/project/customer/task/…),
 * regardless of who it's assigned to — the pages that use this (order/project
 * detail) are staff-only (requireStaffPage), and RLS gives admin/office
 * unconditional reminders access, so this is a like-for-like replacement of
 * the old /api/reminders/list route, which used the same RLS-bound client.
 */
export async function fetchEntityReminders(
  entityKey: string,
  entityId: string,
  includeDone = false
): Promise<EntityReminderRow[]> {
  const supabase = createSupabaseBrowserClient();

  let query = supabase
    .from("reminders")
    .select(
      "id,remind_at,content,status,assigned_to,created_by,source,behavior,severity,notified_at,next_ping_at,snoozed_until,category"
    )
    .eq(entityKey, entityId)
    .order("remind_at", { ascending: true })
    .range(0, 199);
  if (!includeDone) query = query.eq("status", "pending");

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as Row[];
  const assigneeIds = [...new Set(rows.map((r) => s(r, "assigned_to")).filter((v): v is string => Boolean(v)))];
  const nameById = new Map<string, string>();
  if (assigneeIds.length) {
    const { data: users } = await supabase.from("users").select("id,full_name,email").in("id", assigneeIds);
    for (const u of (users ?? []) as Row[]) {
      const id = s(u, "id");
      if (id) nameById.set(id, s(u, "full_name") ?? s(u, "email") ?? id.slice(0, 8));
    }
  }

  return rows.map((r) => ({
    id: s(r, "id") ?? "",
    remindAt: s(r, "remind_at") ?? "",
    content: s(r, "content"),
    status: s(r, "status") ?? "pending",
    assignedTo: s(r, "assigned_to"),
    assignedToName: nameById.get(s(r, "assigned_to") ?? "") ?? null,
    source: s(r, "source") === "system" ? "system" : "manual",
    behavior: s(r, "behavior") ?? "ping_once",
    severity: s(r, "severity") ?? "info",
    notifiedAt: s(r, "notified_at"),
  }));
}
