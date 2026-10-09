import type { CommonPowerSyncDatabase } from "@powersync/web";

// A task's card — the row, its members, comments and open reminders — read
// from the on-device copy (PowerSync) with the same queries /api/tasks/get
// runs on the server, so the task form opens filled in and editable at once
// (components/tasks/TaskUpsertDialog). What the device doesn't hold — the
// task's tags, its finished reminders, its history — still comes from the
// server a moment later.

type Row = Record<string, unknown>;

export type DeviceTaskCard = {
  task: Row;
  memberIds: string[];
  comments: { id: string; author_id: string | null; author_name: string | null; body: string; body_he: string | null; created_at: string; updated_at: string | null }[];
  reminders: {
    id: string;
    remind_at: string;
    content: string | null;
    action_type: string;
    status: string;
    assigned_to: string | null;
    assigned_to_name: string | null;
  }[];
  viewerIsCreator: boolean;
};

const str = (row: Row | null | undefined, key: string): string | null => {
  const value = row?.[key];
  return typeof value === "string" ? value : null;
};

/** The card from the device copy; null when the task isn't on the device (throws when the copy can't be read). */
export async function readTaskCardFromDevice(
  db: CommonPowerSyncDatabase,
  taskId: string,
  viewerId: string
): Promise<DeviceTaskCard | null> {
  const { createLocalSupabase } = await import("@/lib/powersync/local-supabase");
  const local = createLocalSupabase(db);
  const [taskRes, membersRes, commentsRes, remindersRes, peopleRes] = await Promise.all([
    local
      .from("tasks")
      .select(
        "id,business_domain,project_id,property_id,customer_id,assigned_user_id,subject,description,subject_he,description_he,subject_ar,description_ar,due_date,due_time,city,address,priority,status,created_at,updated_at,notes,is_private,private_owner_id"
      )
      .eq("id", taskId)
      .maybeSingle(),
    local.from("task_members").select("user_id").eq("task_id", taskId),
    local
      .from("task_comments")
      .select("id,author_id,body,body_he,created_at,updated_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true })
      .range(0, 199),
    local
      .from("reminders")
      .select("id,remind_at,content,action_type,status,assigned_to,created_at")
      .eq("task_id", taskId)
      .order("remind_at", { ascending: true })
      .range(0, 99),
    local.rpc("user_directory"),
  ]);
  for (const res of [taskRes, membersRes, commentsRes, remindersRes, peopleRes]) {
    if (res.error) throw new Error(res.error.message);
  }
  const task = taskRes.data as Row | null;
  if (!task) return null;

  const names = new Map(((peopleRes.data ?? []) as Row[]).map((u) => [str(u, "id"), str(u, "full_name")]));
  const nameOf = (id: string | null) => (id ? names.get(id) ?? null : null);
  const owner = str(task, "private_owner_id");

  return {
    task,
    memberIds: ((membersRes.data ?? []) as Row[]).map((r) => str(r, "user_id")).filter((v): v is string => Boolean(v)),
    comments: ((commentsRes.data ?? []) as Row[]).map((r) => ({
      id: str(r, "id") ?? "",
      author_id: str(r, "author_id"),
      author_name: nameOf(str(r, "author_id")),
      body: str(r, "body") ?? "",
      body_he: str(r, "body_he"),
      created_at: str(r, "created_at") ?? "",
      updated_at: str(r, "updated_at"),
    })),
    reminders: ((remindersRes.data ?? []) as Row[]).map((r) => ({
      id: str(r, "id") ?? "",
      remind_at: str(r, "remind_at") ?? "",
      content: str(r, "content"),
      action_type: str(r, "action_type") ?? "other",
      status: str(r, "status") ?? "pending",
      assigned_to: str(r, "assigned_to"),
      assigned_to_name: nameOf(str(r, "assigned_to")),
    })),
    viewerIsCreator: Boolean(owner) && owner === viewerId,
  };
}
