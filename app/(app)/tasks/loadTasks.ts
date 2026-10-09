import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskOption, UserOption } from "@/components/tasks/TaskUpsertDialog";
import { translateToArabic } from "@/lib/i18n/translateToHebrew";
import type { Locale } from "@/lib/i18n/types";
import { propertyDisplayName } from "@/lib/properties";
import { earliestReminderByTask, isTaskWaitingForLater } from "@/lib/tasks/visibility";
import { israelDateKey } from "@/lib/timezone";

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
  /** Board position within its status column — drag-reorder persists here. */
  sort_order: number | null;
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
  "id,subject,subject_he,subject_ar,status,priority,due_date,due_time,city,business_domain,project_id,property_id,customer_id,assigned_user_id,is_private,private_owner_id,sort_order";
// What the board reads per task: the task and the two timestamps the "mine"
// union re-ranks by. People's names and colours come from user_directory() in
// the second round (workers can't read other people's user rows).
const TASK_ROW_SELECT = `${TASK_SELECT},created_at,updated_at`;
const OPEN_STATUSES_OR = "status.is.null,status.in.(todo,in_progress,blocked)";

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
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type TasksBoardResult = {
  items: TaskBoardItem[];
  error: string | null;
  /** When the board was read (ms) — the device check compares against a copy at least this fresh. */
  loadedAt: number;
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

  // One read of the board's tasks for a column (open or done) and a scope
  // part. The shared filters are applied while still on the filter builder
  // (filters must come before order/range, which return a transform builder
  // without filter methods).
  //
  // Selection order stays as before (recency) — it only decides WHICH rows make
  // the cut (the done column is capped to the most recently touched). Display
  // order within each column comes from sort_order (see the re-sort below), so a
  // manual drag-reorder (or "newest on top" for a card nobody has moved) is what
  // the board shows.
  const readColumn = (column: "open" | "done", part: "all" | "assignedOrOwned" | "member") => {
    let query =
      part === "member"
        ? // Tasks I'm a member of, through the membership row itself — no
          // separate read of my memberships first.
          supabase.from("tasks").select(`${TASK_ROW_SELECT},task_members!inner(user_id)`).eq("task_members.user_id", userId)
        : supabase.from("tasks").select(TASK_ROW_SELECT);
    query = column === "open" ? query.or(OPEN_STATUSES_OR) : query.eq("status", "done");
    if (part === "assignedOrOwned") query = query.or(`assigned_user_id.eq.${userId},private_owner_id.eq.${userId}`);
    if (priority) query = query.eq("priority", priority);
    if (domain) query = query.eq("business_domain", domain);
    if (linkedId && (domain === "logistics_projects" || domain === "property_management")) {
      query = query.eq(domain === "logistics_projects" ? "project_id" : "property_id", linkedId);
    }
    if (q) query = query.ilike("subject", `%${q.replace(/[%,]/g, " ")}%`);
    return column === "open"
      ? query.order("created_at", { ascending: false, nullsFirst: false }).range(0, OPEN_LIMIT - 1)
      : query.order("updated_at", { ascending: false }).range(0, DONE_LIMIT - 1);
  };

  // Mine = assigned to me, a member of, or a private task I own: the
  // assigned/owned read and the member read go out together, and their union
  // is re-ranked and re-capped exactly as one read would have been.
  const parts = scope === "mine" ? (["assignedOrOwned", "member"] as const) : (["all"] as const);
  const results = await Promise.all([
    ...parts.map((part) => readColumn("open", part)),
    ...parts.map((part) => readColumn("done", part)),
  ]);
  const error = results.find((result) => result.error)?.error?.message ?? null;
  const columnRows = (column: "open" | "done") => {
    const reads = column === "open" ? results.slice(0, parts.length) : results.slice(parts.length);
    const byId = new Map<string, TaskRow>();
    for (const read of reads) {
      for (const row of (read.data ?? []) as unknown as TaskRow[]) byId.set(row.id, row);
    }
    const rankKey = column === "open" ? "created_at" : "updated_at";
    return [...byId.values()]
      .sort((a, b) => (b[rankKey] ?? "").localeCompare(a[rankKey] ?? ""))
      .slice(0, column === "open" ? OPEN_LIMIT : DONE_LIMIT);
  };
  const bySortOrder = (a: TaskRow, b: TaskRow) =>
    (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER);
  const openRows = columnRows("open");
  const doneRows = columnRows("done");
  openRows.sort(bySortOrder);
  doneRows.sort(bySortOrder);
  const taskRows = [...openRows, ...doneRows]
    // Private tasks are visible only to their owner. RLS already enforces this at
    // the DB; this is a belt-and-suspenders guard in case the policy isn't applied.
    .filter((t) => !t.is_private || t.private_owner_id === userId);

  if (taskRows.length === 0) return { items: [], error, loadedAt: Date.now() };

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

  const [projectsRes, propertiesRes, customersRes, membersRes, usersRes, commentsRes, remindersRes, attachmentsRes] =
    await Promise.all([
    projectIds.length
      ? supabase.from("project_dashboard_view").select("id,name").in("id", projectIds)
      : Promise.resolve({ data: [] as Row[] }),
    propertyIds.length
      ? supabase.rpc("property_directory").in("id", propertyIds)
      : Promise.resolve({ data: [] as Row[] }),
    // Direct id lookup (name + phone) — never resolved through a capped picker list.
    customerIds.length
      ? supabase.from("customers").select("id,name,phone").in("id", customerIds)
      : Promise.resolve({ data: [] as Row[] }),
    supabase.from("task_members").select("task_id,user_id").in("task_id", taskIds),
    // Everyone's name and colour (a few dozen rows), alongside the members —
    // their ids aren't known before this round.
    supabase.rpc("user_directory"),
    supabase.from("task_comments").select("task_id").in("task_id", taskIds).range(0, 9999),
    supabase
      .from("reminders")
      .select("task_id,remind_at")
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
  const userRows = (usersRes.data ?? []) as Row[];

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
    userRows.map((r) => [getString(r, "id"), getString(r, "full_name") ?? ""] as const)
  );
  const userColorById = new Map(userRows.map((r) => [getString(r, "id"), getString(r, "avatar_color")] as const));

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

  const nextReminderByTask = earliestReminderByTask((remindersRes.data ?? []) as Row[]);

  const attachmentCountByTask = new Map<string, number>();
  for (const row of (attachmentsRes.data ?? []) as Row[]) {
    const taskId = getString(row, "entity_id");
    if (!taskId) continue;
    attachmentCountByTask.set(taskId, (attachmentCountByTask.get(taskId) ?? 0) + 1);
  }

  const todayIso = israelDateKey();

  const now = new Date();
  const items: TaskBoardItem[] = taskRows
    // A far-future to-do waits off the board until its reminder, or until 30
    // days before it's due (lib/tasks/visibility.ts). A search still finds it —
    // looking for a task by name means you want it, whenever it's due.
    .filter(
      (row) =>
        Boolean(q) ||
        !isTaskWaitingForLater({
          status: row.status,
          dueDate: row.due_date,
          nextReminderAt: nextReminderByTask.get(row.id),
          now,
        })
    )
    .map((row) => {
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
      has_open_reminder: nextReminderByTask.has(row.id),
      is_overdue: isOpen && row.due_date !== null && row.due_date.slice(0, 10) < todayIso,
      is_private: Boolean(row.is_private),
      sort_order: row.sort_order,
    };
  });

  return { items, error, loadedAt: Date.now() };
}

export type TaskPickerOptions = {
  projects: TaskOption[];
  properties: TaskOption[];
  customers: TaskOption[];
  users: UserOption[];
};

/**
 * The task dialog's pickers: projects, properties, active customers and the
 * people a task can be given to. Read under the caller's own access; a list
 * that fails to load is just empty.
 */
export async function loadTaskPickerOptions(supabase: SupabaseClient): Promise<TaskPickerOptions> {
  const [projectsResult, propertiesResult, customersResult, usersResult] = await Promise.all([
    supabase
      .from("project_dashboard_view")
      .select("id,name,customer_name")
      .order("updated_at", { ascending: false })
      .range(0, 999),
    // property_directory(): every property's id, name, address and is_active —
    // all a worker may see of a property.
    supabase
      .rpc("property_directory")
      .order("address", { ascending: true })
      .order("id", { ascending: true })
      .range(0, 999),
    // Active customers for the "linked customer" picker (searchable, A–Z). The card
    // display resolves the name/phone via a direct id query, not this list.
    // Same-name entries (there are several) in a fixed order — by id — so the
    // device's copy of this list matches the server's.
    supabase
      .from("customers")
      .select("id,name,phone,active")
      .eq("active", true)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(0, 1999),
    // user_directory(): everyone's name, colour, role and active flag — all a
    // worker may see of other people.
    supabase.rpc("user_directory").order("full_name", { ascending: true }).order("id", { ascending: true }).range(0, 499),
  ]);

  const projects = ((projectsResult.data ?? []) as Row[])
    .map((p) => {
      const id = getString(p, "id") ?? "";
      const name = getString(p, "name") ?? "";
      const customerName = getString(p, "customer_name");
      const label = customerName ? `${name} (${customerName})` : name;
      return { id, label };
    })
    .filter((p) => p.id && p.label);

  const properties = ((propertiesResult.data ?? []) as Row[])
    .filter((p) => p.is_active !== false)
    .map((p) => ({
      id: getString(p, "id") ?? "",
      label: propertyDisplayName({ name: getString(p, "name"), address: getString(p, "address") ?? "" }),
    }))
    .filter((p) => p.id && p.label);

  const customers = ((customersResult.data ?? []) as Row[])
    .map((c) => {
      const id = getString(c, "id") ?? "";
      const name = getString(c, "name") ?? "";
      const phone = getString(c, "phone");
      // Phone in the label so the searchable picker matches on it too.
      const label = phone ? `${name} · ${phone}` : name;
      return { id, label };
    })
    .filter((c) => c.id && c.label);

  // Only people with system access can be assigned / added as task members;
  // no-access workers (payroll-only, can't log in) are left out of the pickers.
  const users = ((usersResult.data ?? []) as Row[])
    .filter((u) => u.active !== false && u.role !== "worker_no_access")
    .map((u) => ({
      id: getString(u, "id") ?? "",
      label: getString(u, "full_name") ?? "",
      color: getString(u, "avatar_color"),
    }))
    .filter((u) => u.id && u.label);

  return { projects, properties, customers, users };
}
