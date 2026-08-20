import type { SupabaseClient } from "@supabase/supabase-js";
import { translateToArabic } from "@/lib/i18n/translateToHebrew";
import type { Locale } from "@/lib/i18n/types";

type Row = Record<string, unknown>;

export type TaskMember = { id: string; name: string; color: string | null };

export type TaskBoardItem = {
  id: string;
  subject: string;
  /** Hebrew translation, auto-filled when authored by a locale=ar worker. */
  subject_he: string | null;
  /** Arabic translation, lazily cached the first time a locale=ar viewer reads a Hebrew-authored task. */
  subject_ar: string | null;
  status: string | null;
  priority: string | null;
  due_date: string | null;
  due_time: string | null;
  city: string | null;
  business_domain: string | null;
  project_id: string | null;
  property_id: string | null;
  customer_id: string | null;
  project_name: string | null;
  property_name: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  members: TaskMember[];
  comment_count: number;
  /** Files/photos linked to this task — drives the card's paperclip. */
  attachment_count: number;
  has_open_reminder: boolean;
  is_overdue: boolean;
  is_private: boolean;
};

export type TasksFilters = {
  q: string;
  priority: string;
  domain: string;
  linkedId: string;
  // "mine" = assigned to me OR a member; "all" = everyone (back-office only).
  scope: "mine" | "all";
};

// Columns shown on the board (default order — each user can drag to reorder).
// `cancelled` is intentionally excluded (reachable via filters/detail); null
// status is treated as `todo`.
export const BOARD_STATUSES = ["todo", "in_progress", "done", "blocked"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

// Keep the done column light — only recently-touched done cards.
const DONE_LIMIT = 60;
const OPEN_LIMIT = 1000;

const TASK_SELECT =
  "id,subject,subject_he,subject_ar,status,priority,due_date,due_time,city,business_domain,project_id,property_id,customer_id,assigned_user_id,is_private,private_owner_id";

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function uniqueIds(rows: Row[], key: string) {
  return [...new Set(rows.map((row) => getString(row, key)).filter((v): v is string => Boolean(v)))];
}

type TaskRow = {
  id: string;
  subject: string | null;
  subject_he: string | null;
  subject_ar: string | null;
  status: string | null;
  priority: string | null;
  due_date: string | null;
  due_time: string | null;
  city: string | null;
  business_domain: string | null;
  project_id: string | null;
  property_id: string | null;
  customer_id: string | null;
  assigned_user_id: string | null;
  is_private: boolean | null;
  private_owner_id: string | null;
};

export type TasksBoardResult = {
  items: TaskBoardItem[];
  error: string | null;
};

/**
 * Load the full board (all non-cancelled tasks for the scope/filters), with
 * members, project/property names, comment counts and open-reminder flags
 * resolved for the cards. Open columns are loaded in full (capped); the done
 * column is limited to recently-updated cards.
 */
export async function loadTasksBoard(
  supabase: SupabaseClient,
  {
    filters,
    userId,
    canSeeAll,
    locale = "he",
  }: { filters: TasksFilters; userId: string; canSeeAll: boolean; locale?: Locale }
): Promise<TasksBoardResult> {
  const { q, priority, domain, linkedId } = filters;
  const scope = canSeeAll ? filters.scope : "mine";

  // Tasks I'm a member of (for the "mine" scope union with assigned_user_id).
  let memberTaskIds: string[] = [];
  if (scope === "mine") {
    const { data } = await supabase
      .from("task_members")
      .select("task_id")
      .eq("user_id", userId)
      .range(0, 999);
    memberTaskIds = uniqueIds((data ?? []) as Row[], "task_id");
  }

  // Apply the shared filters while still on the filter builder (filters must come
  // before order/range, which return a transform builder without filter methods).
  let openFilter = supabase
    .from("tasks")
    .select(TASK_SELECT)
    .or("status.is.null,status.in.(todo,in_progress,blocked)");
  let doneFilter = supabase.from("tasks").select(TASK_SELECT).eq("status", "done");

  if (scope === "mine") {
    // Mine = assigned to me, a member of, or a private task I own.
    const parts = [`assigned_user_id.eq.${userId}`, `private_owner_id.eq.${userId}`];
    if (memberTaskIds.length > 0) parts.push(`id.in.(${memberTaskIds.join(",")})`);
    const mineOr = parts.join(",");
    openFilter = openFilter.or(mineOr);
    doneFilter = doneFilter.or(mineOr);
  }
  if (priority) {
    openFilter = openFilter.eq("priority", priority);
    doneFilter = doneFilter.eq("priority", priority);
  }
  if (domain) {
    openFilter = openFilter.eq("business_domain", domain);
    doneFilter = doneFilter.eq("business_domain", domain);
  }
  if (linkedId && (domain === "logistics_projects" || domain === "property_management")) {
    const linkCol = domain === "logistics_projects" ? "project_id" : "property_id";
    openFilter = openFilter.eq(linkCol, linkedId);
    doneFilter = doneFilter.eq(linkCol, linkedId);
  }
  if (q) {
    const escaped = `%${q.replace(/[%,]/g, " ")}%`;
    openFilter = openFilter.ilike("subject", escaped);
    doneFilter = doneFilter.ilike("subject", escaped);
  }

  const openQuery = openFilter
    .order("created_at", { ascending: false, nullsFirst: false })
    .range(0, OPEN_LIMIT - 1);
  const doneQuery = doneFilter.order("updated_at", { ascending: false }).range(0, DONE_LIMIT - 1);

  const [openRes, doneRes] = await Promise.all([openQuery, doneQuery]);
  const error = openRes.error?.message ?? doneRes.error?.message ?? null;
  const taskRows = [...((openRes.data ?? []) as TaskRow[]), ...((doneRes.data ?? []) as TaskRow[])]
    // Private tasks are visible only to their owner. RLS already enforces this at
    // the DB; this is a belt-and-suspenders guard in case the policy isn't applied.
    .filter((t) => !t.is_private || t.private_owner_id === userId);

  if (taskRows.length === 0) return { items: [], error };

  // An Arabic-locale viewer reading a task NOT authored by an Arabic worker
  // (subject_he is only ever set when the writer's own locale was 'ar' — see
  // app/api/tasks/create — so its absence means the original is presumably
  // Hebrew) gets it translated here, cached back onto the row so future loads
  // don't re-call OpenAI. Best-effort: a failed translate or a blocked update
  // (RLS) just means the Hebrew text shows again next time, not an error.
  if (locale === "ar") {
    const needsTranslation = taskRows.filter((row) => !row.subject_he && !row.subject_ar && row.subject);
    if (needsTranslation.length > 0) {
      await Promise.all(
        needsTranslation.map(async (row) => {
          const translated = await translateToArabic(row.subject ?? "");
          if (!translated) return;
          row.subject_ar = translated;
          await supabase.from("tasks").update({ subject_ar: translated }).eq("id", row.id);
        })
      );
    }
  }

  const taskIds = taskRows.map((t) => t.id);
  const projectIds = uniqueIds(taskRows as unknown as Row[], "project_id");
  const propertyIds = uniqueIds(taskRows as unknown as Row[], "property_id");
  const customerIds = uniqueIds(taskRows as unknown as Row[], "customer_id");

  const [projectsRes, propertiesRes, customersRes, membersRes, commentsRes, remindersRes, attachmentsRes] =
    await Promise.all([
    projectIds.length
      ? supabase.from("project_dashboard_view").select("id,name").in("id", projectIds)
      : Promise.resolve({ data: [] as Row[] }),
    propertyIds.length
      ? supabase.from("properties").select("id,address").in("id", propertyIds)
      : Promise.resolve({ data: [] as Row[] }),
    // Direct id lookup (name + phone) — never resolved through a capped picker list.
    customerIds.length
      ? supabase.from("customers").select("id,name,phone").in("id", customerIds)
      : Promise.resolve({ data: [] as Row[] }),
    supabase.from("task_members").select("task_id,user_id").in("task_id", taskIds),
    supabase.from("task_comments").select("task_id").in("task_id", taskIds).range(0, 9999),
    supabase
      .from("reminders")
      .select("task_id")
      .in("task_id", taskIds)
      .eq("status", "pending")
      .range(0, 9999),
    // Attachments are documents linked polymorphically, not a task column — so
    // the card's paperclip comes from document_links, same shape the card's
    // comment/reminder indicators use. Tolerant: a failure here must not take
    // down the board over an icon.
    supabase
      .from("document_links")
      .select("entity_id")
      .eq("entity_type", "task")
      .in("entity_id", taskIds)
      .range(0, 9999)
      .then((r) => r, () => ({ data: [] as Row[] })),
  ]);

  const memberRows = (membersRes.data ?? []) as Row[];
  const assigneeIds = uniqueIds(taskRows as unknown as Row[], "assigned_user_id");
  const memberUserIds = uniqueIds(memberRows, "user_id");
  const allUserIds = [...new Set([...assigneeIds, ...memberUserIds])];

  const usersRes = allUserIds.length
    ? await supabase.from("users").select("id,full_name,email,avatar_color").in("id", allUserIds)
    : { data: [] as Row[] };

  const projectNameById = new Map(
    ((projectsRes.data ?? []) as Row[]).map((r) => [getString(r, "id"), getString(r, "name")] as const)
  );
  const propertyNameById = new Map(
    ((propertiesRes.data ?? []) as Row[]).map((r) => [getString(r, "id"), getString(r, "address")] as const)
  );
  const customerById = new Map(
    ((customersRes.data ?? []) as Row[]).map(
      (r) => [getString(r, "id"), { name: getString(r, "name"), phone: getString(r, "phone") }] as const
    )
  );
  const userNameById = new Map(
    ((usersRes.data ?? []) as Row[]).map(
      (r) => [getString(r, "id"), getString(r, "full_name") ?? getString(r, "email") ?? ""] as const
    )
  );
  const userColorById = new Map(
    ((usersRes.data ?? []) as Row[]).map((r) => [getString(r, "id"), getString(r, "avatar_color")] as const)
  );

  const membersByTask = new Map<string, TaskMember[]>();
  for (const row of memberRows) {
    const taskId = getString(row, "task_id");
    const memberId = getString(row, "user_id");
    if (!taskId || !memberId) continue;
    const list = membersByTask.get(taskId) ?? [];
    list.push({ id: memberId, name: userNameById.get(memberId) ?? "", color: userColorById.get(memberId) ?? null });
    membersByTask.set(taskId, list);
  }

  const commentCountByTask = new Map<string, number>();
  for (const row of (commentsRes.data ?? []) as Row[]) {
    const taskId = getString(row, "task_id");
    if (!taskId) continue;
    commentCountByTask.set(taskId, (commentCountByTask.get(taskId) ?? 0) + 1);
  }

  const reminderTaskIds = new Set(
    ((remindersRes.data ?? []) as Row[]).map((r) => getString(r, "task_id")).filter(Boolean) as string[]
  );

  const attachmentCountByTask = new Map<string, number>();
  for (const row of (attachmentsRes.data ?? []) as Row[]) {
    const taskId = getString(row, "entity_id");
    if (!taskId) continue;
    attachmentCountByTask.set(taskId, (attachmentCountByTask.get(taskId) ?? 0) + 1);
  }

  const todayIso = new Date().toISOString().slice(0, 10);

  const items: TaskBoardItem[] = taskRows.map((row) => {
    const assigneeId = row.assigned_user_id;
    const assigneeName = assigneeId ? userNameById.get(assigneeId) ?? null : null;
    const extraMembers = membersByTask.get(row.id) ?? [];
    // Avatars: primary assignee first, then extra members.
    const members: TaskMember[] = [
      ...(assigneeId
        ? [{ id: assigneeId, name: assigneeName ?? "", color: userColorById.get(assigneeId) ?? null }]
        : []),
      ...extraMembers.filter((m) => m.id !== assigneeId),
    ];
    const status = row.status;
    const isOpen = status !== "done" && status !== "cancelled";
    return {
      id: row.id,
      subject: row.subject ?? "משימה",
      subject_he: row.subject_he,
      subject_ar: row.subject_ar,
      status,
      priority: row.priority,
      due_date: row.due_date,
      due_time: row.due_time,
      city: row.city,
      business_domain: row.business_domain,
      project_id: row.project_id,
      property_id: row.property_id,
      customer_id: row.customer_id,
      project_name: row.project_id ? projectNameById.get(row.project_id) ?? null : null,
      property_name: row.property_id ? propertyNameById.get(row.property_id) ?? null : null,
      customer_name: row.customer_id ? customerById.get(row.customer_id)?.name ?? null : null,
      customer_phone: row.customer_id ? customerById.get(row.customer_id)?.phone ?? null : null,
      assigned_user_id: assigneeId,
      assigned_user_name: assigneeName,
      members,
      comment_count: commentCountByTask.get(row.id) ?? 0,
      attachment_count: attachmentCountByTask.get(row.id) ?? 0,
      has_open_reminder: reminderTaskIds.has(row.id),
      is_overdue: isOpen && row.due_date !== null && row.due_date.slice(0, 10) < todayIso,
      is_private: Boolean(row.is_private),
    };
  });

  return { items, error };
}
