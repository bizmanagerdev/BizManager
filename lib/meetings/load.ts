import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Meeting,
  MeetingItem,
  MeetingItemKind,
  MeetingTask,
  MeetingTemplate,
  WeekStats,
} from "@/lib/meetings/types";

// Server-side reads for ישיבה שבועית. Writes live either in the client (single
// table, RLS-gated — see the hybrid direct-Supabase policy) or, for opening a
// meeting, in app/api/meetings/open, because that one touches four tables.

type Row = Record<string, unknown>;

function str(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(row: Row, key: string): number | null {
  const v = row[key];
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strArray(row: Row, key: string): string[] {
  const v = row[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function kindOf(row: Row): MeetingItemKind {
  return str(row, "kind") === "prep" ? "prep" : "agenda";
}

export function mapTemplate(row: Row): MeetingTemplate {
  return {
    id: str(row, "id") ?? "",
    kind: kindOf(row),
    position: num(row, "position") ?? 0,
    title: str(row, "title") ?? "",
    subpoints: strArray(row, "subpoints"),
    linkHref: str(row, "link_href"),
    linkLabel: str(row, "link_label"),
    defaultAssigneeId: str(row, "default_assignee_id"),
    autoSource: str(row, "auto_source"),
    isActive: row.is_active !== false,
  };
}

/** Every template row, active first-class — the settings view edits this list. */
export async function loadTemplates(
  supabase: SupabaseClient,
  options: { activeOnly?: boolean } = {}
): Promise<MeetingTemplate[]> {
  let query = supabase
    .from("meeting_templates")
    .select("*")
    .order("kind", { ascending: true })
    .order("position", { ascending: true });
  if (options.activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) return [];
  return ((data ?? []) as Row[]).map(mapTemplate);
}

function mapMeeting(row: Row): Meeting {
  return {
    id: str(row, "id") ?? "",
    meetingDate: str(row, "meeting_date") ?? "",
    status: str(row, "status") === "closed" ? "closed" : "open",
    notes: str(row, "notes"),
    stats: (row.stats as WeekStats | null) ?? null,
    collectionTarget: num(row, "collection_target"),
    nextMeetingDate: str(row, "next_meeting_date"),
    closedAt: str(row, "closed_at"),
  };
}

/** The most recent meetings, newest first — the history list and "what's current". */
export async function loadMeetings(supabase: SupabaseClient, limit = 60): Promise<Meeting[]> {
  const { data, error } = await supabase
    .from("meetings")
    .select("*")
    .order("meeting_date", { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data ?? []) as Row[]).map(mapMeeting);
}

export async function loadMeetingById(supabase: SupabaseClient, id: string): Promise<Meeting | null> {
  const { data, error } = await supabase.from("meetings").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return mapMeeting(data as Row);
}

/** The meeting immediately before `meetingDate` — the source of carry-overs and of last week's target. */
export async function loadPreviousMeeting(
  supabase: SupabaseClient,
  meetingDate: string
): Promise<Meeting | null> {
  const { data, error } = await supabase
    .from("meetings")
    .select("*")
    .lt("meeting_date", meetingDate)
    .order("meeting_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return mapMeeting(data as Row);
}

export async function loadMeetingItems(
  supabase: SupabaseClient,
  meetingId: string
): Promise<MeetingItem[]> {
  const { data, error } = await supabase
    .from("meeting_items")
    .select("*")
    .eq("meeting_id", meetingId)
    .order("kind", { ascending: true })
    .order("position", { ascending: true });
  if (error) return [];
  const rows = (data ?? []) as Row[];

  // Names for the two user columns, and the dates of the meetings items were
  // carried from — both resolved in one round trip each rather than per row.
  const userIds = new Set<string>();
  const meetingIds = new Set<string>();
  for (const row of rows) {
    const doneBy = str(row, "done_by");
    if (doneBy) userIds.add(doneBy);
    const carried = str(row, "carried_over_from");
    if (carried) meetingIds.add(carried);
  }

  const [userNames, meetingDates] = await Promise.all([
    resolveUserNames(supabase, [...userIds]),
    resolveMeetingDates(supabase, [...meetingIds]),
  ]);

  return rows.map((row) => {
    const doneBy = str(row, "done_by");
    const carried = str(row, "carried_over_from");
    return {
      id: str(row, "id") ?? "",
      meetingId: str(row, "meeting_id") ?? "",
      templateId: str(row, "template_id"),
      kind: kindOf(row),
      position: num(row, "position") ?? 0,
      title: str(row, "title") ?? "",
      subpoints: strArray(row, "subpoints"),
      linkHref: str(row, "link_href"),
      linkLabel: str(row, "link_label"),
      autoSource: str(row, "auto_source"),
      isDone: row.is_done === true,
      doneBy,
      doneByName: doneBy ? userNames.get(doneBy) ?? null : null,
      doneAt: str(row, "done_at"),
      assignedUserId: str(row, "assigned_user_id"),
      notes: str(row, "notes"),
      carriedOverFrom: carried,
      carriedOverFromDate: carried ? meetingDates.get(carried) ?? null : null,
    };
  });
}

async function resolveUserNames(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data } = await supabase.from("users").select("id,full_name,email").in("id", ids);
  for (const row of (data ?? []) as Row[]) {
    const id = str(row, "id");
    if (!id) continue;
    map.set(id, str(row, "full_name") ?? str(row, "email") ?? "משתמש");
  }
  return map;
}

async function resolveMeetingDates(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data } = await supabase.from("meetings").select("id,meeting_date").in("id", ids);
  for (const row of (data ?? []) as Row[]) {
    const id = str(row, "id");
    const date = str(row, "meeting_date");
    if (id && date) map.set(id, date);
  }
  return map;
}

/**
 * The tasks raised at a meeting, each with the status it holds RIGHT NOW —
 * that "now" is the point of agenda item 0: what we committed to last week,
 * and what actually happened to it.
 */
export async function loadMeetingTasks(
  supabase: SupabaseClient,
  meetingId: string
): Promise<MeetingTask[]> {
  const { data, error } = await supabase
    .from("meeting_task_links")
    .select("task_id,meeting_item_id")
    .eq("meeting_id", meetingId);
  if (error) return [];
  const links = (data ?? []) as Row[];
  if (links.length === 0) return [];

  const taskIds = [...new Set(links.map((l) => str(l, "task_id")).filter((v): v is string => Boolean(v)))];
  const itemIds = [...new Set(links.map((l) => str(l, "meeting_item_id")).filter((v): v is string => Boolean(v)))];

  const [tasksResult, itemsResult] = await Promise.all([
    supabase.from("tasks").select("id,subject,status,assigned_user_id,due_date").in("id", taskIds),
    itemIds.length > 0
      ? supabase.from("meeting_items").select("id,title").in("id", itemIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  const taskById = new Map<string, Row>();
  for (const row of ((tasksResult.data ?? []) as Row[])) {
    const id = str(row, "id");
    if (id) taskById.set(id, row);
  }
  const itemTitleById = new Map<string, string>();
  for (const row of ((itemsResult.data ?? []) as Row[])) {
    const id = str(row, "id");
    const title = str(row, "title");
    if (id && title) itemTitleById.set(id, title);
  }

  const assigneeIds = [
    ...new Set(
      [...taskById.values()].map((t) => str(t, "assigned_user_id")).filter((v): v is string => Boolean(v))
    ),
  ];
  const names = await resolveUserNames(supabase, assigneeIds);

  const out: MeetingTask[] = [];
  for (const link of links) {
    const taskId = str(link, "task_id");
    if (!taskId) continue;
    const task = taskById.get(taskId);
    // The task was deleted since — its link tells us nothing, so it is dropped
    // rather than listed as a ghost with no status.
    if (!task) continue;
    const itemId = str(link, "meeting_item_id");
    const assignee = str(task, "assigned_user_id");
    out.push({
      taskId,
      meetingItemId: itemId,
      itemTitle: itemId ? itemTitleById.get(itemId) ?? null : null,
      subject: str(task, "subject") ?? "משימה",
      status: str(task, "status") ?? "todo",
      assignedUserId: assignee,
      assigneeName: assignee ? names.get(assignee) ?? null : null,
      dueDate: str(task, "due_date"),
    });
  }
  // Not-done first: the whole point of item 0 is what is still open.
  return out.sort((a, b) => Number(isTaskSettled(a.status)) - Number(isTaskSettled(b.status)));
}

export function isTaskSettled(status: string): boolean {
  return status === "done" || status === "cancelled";
}

export type UserOption = { id: string; label: string };

/** Assignable people — prep owners and the "+ משימה" picker share this list. */
export async function loadAssignableUsers(supabase: SupabaseClient): Promise<UserOption[]> {
  const { data, error } = await supabase
    .from("users")
    .select("id,full_name,email")
    .eq("active", true)
    .eq("system_access", true)
    .order("full_name", { ascending: true });
  if (error) return [];
  return ((data ?? []) as Row[])
    .map((row) => ({
      id: str(row, "id") ?? "",
      label: str(row, "full_name") ?? str(row, "email") ?? "משתמש",
    }))
    .filter((u) => u.id);
}
