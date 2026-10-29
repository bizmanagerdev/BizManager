import type { SupabaseClient } from "@supabase/supabase-js";
import { snoozedTasks } from "@/lib/tasks/snooze";
import { getOpenReminders, actionTypeLabel } from "@/lib/communications";
import { getOrderStatusLabel } from "@/lib/ui/status-colors";
import { fetchAllPaged } from "@/lib/supabase/paginate";

type Row = Record<string, unknown>;

export type CalendarEntryKind = "project" | "task" | "reminder" | "delivery";

export type CalendarEntry = {
  id: string;
  kind: CalendarEntryKind;
  title: string;
  subtitle: string;
  href: string;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  priority: string | null;
};

export type ScheduleScope = "mine" | "all";

const OPEN_TASK_STATUSES = ["todo", "in_progress", "blocked"];

// Same list every orders/deliveries loader duplicates locally (loadOrders.ts,
// loadDeliveries.ts) — a requested delivery date on an order that's already
// delivered/closed/cancelled is no longer relevant. The Hebrew values are real
// historical status strings, not just the current English ones.
const CLOSED_ORDER_STATUSES = [
  "delivered",
  "completed",
  "closed",
  "cancelled",
  "סופקה",
  "הושלמה",
  "סגורה",
  "בוטלה",
];

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

/**
 * "14:00" out of a stored time, or null. `tasks.due_time` is free TEXT (see
 * db/sql/tasks_trello_upgrade.sql), so anything that isn't a plain HH:MM is
 * dropped rather than printed on a card. Seconds, if present, are cut.
 */
function hhmm(value: string | null): string | null {
  const match = value ? /^([01]\d|2[0-3]):([0-5]\d)/.exec(value.trim()) : null;
  return match ? `${match[1]}:${match[2]}` : null;
}

/**
 * A UTC timestamp's calendar date/time AS SEEN IN ISRAEL — this runs on the
 * server (Node's default timezone is UTC), so slicing/regexing the raw ISO
 * string (the previous approach) printed the UTC hour and could even land on
 * the wrong UTC calendar day for anything scheduled near Israel midnight.
 * Mirrors lib/date.ts's hebrewWeekday(), the one other place in this codebase
 * that already gets this right.
 */
function israelDateOnly(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(iso));
}
function israelTimeOnly(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jerusalem",
  }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function uniqueIds(rows: Row[], key: string) {
  return [
    ...new Set(rows.map((row) => (typeof row[key] === "string" ? (row[key] as string) : "")).filter(Boolean)),
  ];
}

function compareNullableDates(a: string | null, b: string | null) {
  if (a && b) return a.localeCompare(b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

/** Ids in batches of 150 at most (a long .in() list overflows the request). */
function idBatches(ids: string[]): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 150) batches.push(ids.slice(i, i + 150));
  return batches;
}

/** A read over every batch of `ids`: the rows of all of them (no ids, no request). */
async function rowsByIds(read: (batch: string[]) => PromiseLike<{ data: unknown }>, ids: string[]): Promise<Row[]> {
  const pages = await Promise.all(idBatches(ids).map((batch) => read(batch).then(({ data }) => (data ?? []) as Row[])));
  return pages.flat();
}

/** What the calendar reads, before it becomes entries. */
type ScheduleRows = {
  tasks: Row[];
  projects: Row[];
  deliveryOrders: Row[];
  reminders: Awaited<ReturnType<typeof getOpenReminders>>;
};

type ScheduleNames = {
  projectNameById: Map<string, string | null>;
  userNameById: Map<string, string | null>;
  customerNameById: Map<string, string | null>;
};

/** The orders someone picked me to see on my calendar (order_delivery_recipients). */
async function myRecipientOrderIds(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data: recipientRows } = await supabase
    .from("order_delivery_recipients")
    .select("order_id")
    .eq("user_id", userId);
  return [
    ...new Set(
      ((recipientRows ?? []) as Row[])
        .map((r) => getString(r, "order_id"))
        .filter((id): id is string => Boolean(id))
    ),
  ];
}

/**
 * Every row the feed shows, paged through: no list stops at 500 (projects
 * came oldest first, so the newest were the ones a cut-off would have left
 * out). `scope` filters on the base tables, as getScheduleEntries describes.
 */
async function readScheduleRows(
  supabase: SupabaseClient,
  { scope, userId }: { scope: ScheduleScope; userId: string }
): Promise<ScheduleRows & { snoozed: Map<string, string> }> {
  // "Mine" = orders I created, PLUS orders someone explicitly picked me as a
  // recipient for (order_delivery_recipients) — e.g. a driver who didn't
  // create the order but was told to see it on their own calendar. That lookup
  // only gates the orders' filter, so it must not block the tasks, projects
  // and reminders from being read at the same time — folded into one async
  // step below that runs concurrently with the other three.
  const deliveriesPromise = (async () => {
    const recipientOrderIds = scope === "mine" ? await myRecipientOrderIds(supabase, userId) : [];
    return fetchAllPaged<Row>((from, to) => {
      let query = supabase
        .from("orders")
        .select("id,customer_id,status,requested_delivery_date,created_by")
        .not("requested_delivery_date", "is", null)
        .not("status", "in", `(${CLOSED_ORDER_STATUSES.join(",")})`)
        .order("requested_delivery_date", { ascending: true })
        .order("id", { ascending: true });
      if (scope === "mine") {
        query =
          recipientOrderIds.length > 0
            ? query.or(`created_by.eq.${userId},id.in.(${recipientOrderIds.join(",")})`)
            : query.eq("created_by", userId);
      }
      return query.range(from, to);
    });
  })();

  const [tasks, projects, deliveryOrders, reminders, snoozed] = await Promise.all([
    fetchAllPaged<Row>((from, to) => {
      let query = supabase
        .from("tasks")
        .select("id,subject,status,priority,due_date,due_time,assigned_user_id,project_id")
        .in("status", OPEN_TASK_STATUSES)
        .order("due_date", { ascending: true })
        .order("id", { ascending: true });
      if (scope === "mine") query = query.eq("assigned_user_id", userId);
      return query.range(from, to);
    }),
    fetchAllPaged<Row>((from, to) => {
      let query = supabase
        .from("projects")
        .select("id,name,status,start_date,end_date,project_manager_id,customer_id")
        .order("start_date", { ascending: true })
        .order("id", { ascending: true });
      if (scope === "mine") query = query.eq("project_manager_id", userId);
      return query.range(from, to);
    }),
    deliveriesPromise,
    getOpenReminders(supabase, { scope, userId, limit: "all" }),
    // My own snoozed tasks are off my schedule until they're back (lib/tasks/snooze.ts).
    scope === "mine" ? snoozedTasks(supabase, userId) : Promise.resolve(new Map<string, string>()),
  ]);
  return { tasks, projects, deliveryOrders, reminders, snoozed };
}

/** Names: task→project, task→assignee, project/order→customer — in batches of 150 ids. */
async function resolveScheduleNames(supabase: SupabaseClient, rows: ScheduleRows): Promise<ScheduleNames> {
  const taskProjectIds = uniqueIds(rows.tasks, "project_id");
  const taskUserIds = uniqueIds(rows.tasks, "assigned_user_id");
  const customerIds = [
    ...new Set([...uniqueIds(rows.projects, "customer_id"), ...uniqueIds(rows.deliveryOrders, "customer_id")]),
  ];

  const [projectNames, userNames, customerNames] = await Promise.all([
    rowsByIds((batch) => supabase.from("projects").select("id,name").in("id", batch), taskProjectIds),
    rowsByIds((batch) => supabase.rpc("user_directory").in("id", batch), taskUserIds),
    rowsByIds((batch) => supabase.from("customers").select("id,name").in("id", batch), customerIds),
  ]);

  const byId = (list: Row[], name: (r: Row) => string | null) =>
    new Map(
      list
        .map((r) => [getString(r, "id"), name(r)] as const)
        .filter((e): e is readonly [string, string | null] => Boolean(e[0]))
    );
  return {
    projectNameById: byId(projectNames, (r) => getString(r, "name")),
    userNameById: byId(userNames, (r) => getString(r, "full_name") ?? getString(r, "email")),
    customerNameById: byId(customerNames, (r) => getString(r, "name")),
  };
}

/** The rows as the calendar's entries, in one fixed order. */
function buildScheduleEntries(rows: ScheduleRows, names: ScheduleNames, scope: ScheduleScope): CalendarEntry[] {
  const { projectNameById, userNameById, customerNameById } = names;

  const taskEntries: CalendarEntry[] = rows.tasks
    .map((row) => {
      const taskId = getString(row, "id") ?? "";
      const projectId = getString(row, "project_id");
      const assigneeId = getString(row, "assigned_user_id");
      const subtitleParts = [
        // The hour FIRST when the task has one (tasks.due_time, free text
        // 'HH:MM'), the way a reminder's subtitle already reads: on a day's list
        // "when" is what you scan for, and a task at 14:00 is a different thing
        // from one due sometime today.
        hhmm(getString(row, "due_time")),
        projectId ? projectNameById.get(projectId) ?? null : null,
        // WHO only when the feed can hold someone else's work. Under scope
        // "mine" every row is the viewer's by definition, so printing their own
        // name on every line said nothing (user, 2026-08-18: "I don't need my
        // name here").
        scope === "all" && assigneeId ? userNameById.get(assigneeId) ?? null : null,
      ].filter((value): value is string => Boolean(value && value.trim()));
      const due = getString(row, "due_date");
      return {
        id: taskId,
        kind: "task" as const,
        title: getString(row, "subject") ?? "משימה",
        // Empty when there's nothing to say — no hour, no project, nobody else's
        // name. "ללא שיוך" was a label for the ABSENCE of detail: it took a line
        // on every unassigned task to tell you nothing. Every surface that prints
        // a subtitle already guards on it being empty.
        subtitle: subtitleParts.join(" • "),
        href: `/tasks/${taskId}`,
        startDate: due,
        endDate: due,
        status: getString(row, "status"),
        priority: getString(row, "priority"),
      };
    })
    .filter((row) => row.id && row.startDate);

  const reminderEntries: CalendarEntry[] = rows.reminders
    .map((r) => {
      const day = r.remind_at ? israelDateOnly(r.remind_at) : null;
      // Same detail the תזכורות panel shows: a task-linked reminder reads as its
      // task subject (+ "משימה"), otherwise the content / customer with the
      // action-type label — never a bare "תזכורת — ללא לקוח".
      const time = r.remind_at ? israelTimeOnly(r.remind_at) : null;
      const title = r.task_subject?.trim() || r.content?.trim() || r.customer_name?.trim() || "תזכורת";
      const typeLabel = r.task_subject ? "משימה" : actionTypeLabel(r.action_type);
      const subtitle = [
        typeLabel,
        time,
        // only add the customer if it isn't already the title
        r.customer_name && r.customer_name.trim() !== title ? r.customer_name.trim() : null,
      ]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join(" • ");
      return {
        id: r.id,
        kind: "reminder" as const,
        title,
        subtitle,
        href: r.task_id
          ? `/tasks/${r.task_id}`
          : r.customer_id
            ? `/collections?focus=${encodeURIComponent(r.customer_id)}`
            : "/collections",
        startDate: day,
        endDate: day,
        status: r.status,
        priority: null,
      };
    })
    .filter((row) => row.id && row.startDate);

  const projectEntries: CalendarEntry[] = rows.projects
    .map((row) => {
      const projectId = getString(row, "id") ?? "";
      const customerId = getString(row, "customer_id");
      return {
        id: projectId,
        kind: "project" as const,
        title: getString(row, "name") ?? "פרויקט",
        subtitle: (customerId ? customerNameById.get(customerId) : null) ?? "ללא לקוח",
        href: `/projects/${projectId}`,
        startDate: getString(row, "start_date"),
        endDate: getString(row, "end_date"),
        status: getString(row, "status"),
        priority: null,
      };
    })
    .filter((row) => row.id && row.startDate);

  const deliveryEntries: CalendarEntry[] = rows.deliveryOrders
    .map((row) => {
      const orderId = getString(row, "id") ?? "";
      const customerId = getString(row, "customer_id");
      const date = getString(row, "requested_delivery_date");
      return {
        id: orderId,
        kind: "delivery" as const,
        title: (customerId ? customerNameById.get(customerId) : null) ?? "לקוח",
        subtitle: getOrderStatusLabel(getString(row, "status") ?? ""),
        href: `/sales/orders/${orderId}`,
        startDate: date,
        endDate: date,
        status: getString(row, "status"),
        priority: null,
      };
    })
    .filter((row) => row.id && row.startDate);

  // On a day: tasks, reminders, projects, deliveries; then by name — and the
  // id last, so two items with the same name on the same day keep one order
  // here and on the device (the daily check compares the lists in order). It
  // used to put tasks first and leave the rest as they came.
  return [...taskEntries, ...reminderEntries, ...projectEntries, ...deliveryEntries].sort((a, b) => {
    const byStart = compareNullableDates(a.startDate, b.startDate);
    if (byStart !== 0) return byStart;
    const byKind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (byKind !== 0) return byKind;
    const byTitle = a.title.localeCompare(b.title, "he");
    if (byTitle !== 0) return byTitle;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

const KIND_RANK: Record<CalendarEntryKind, number> = { task: 0, reminder: 1, project: 2, delivery: 3 };

/**
 * Unified calendar feed: open tasks (by due date), projects (by start/end),
 * pending reminders (by remind_at) and orders with a customer-requested
 * delivery date. `scope` decides personal vs everything:
 *   - "mine" → tasks assigned to me, projects I manage, reminders I own/created,
 *     orders I created.
 *   - "all"  → everything (back-office only; gated by the caller).
 * Ownership is filtered on the base tables (`tasks.assigned_user_id`,
 * `projects.project_manager_id`, `orders.created_by` — the closest analog,
 * since orders have no assignee column) since the *_view layers don't expose
 * those columns; display names are resolved with small follow-up lookups.
 */
export async function getScheduleEntries(
  supabase: SupabaseClient,
  { scope, userId }: { scope: ScheduleScope; userId: string }
): Promise<CalendarEntry[]> {
  const { snoozed, ...rows } = await readScheduleRows(supabase, { scope, userId });
  const shown = { ...rows, tasks: rows.tasks.filter((row) => !snoozed.has(getString(row, "id") ?? "")) };
  return buildScheduleEntries(shown, await resolveScheduleNames(supabase, shown), scope);
}

/** Everyone's rows narrowed to mine, by getScheduleEntries' "mine" rules. */
function mineOf(
  rows: ScheduleRows,
  userId: string,
  recipientOrderIds: ReadonlySet<string>,
  snoozed: ReadonlyMap<string, string>
): ScheduleRows {
  return {
    tasks: rows.tasks.filter(
      (row) => getString(row, "assigned_user_id") === userId && !snoozed.has(getString(row, "id") ?? "")
    ),
    projects: rows.projects.filter((row) => getString(row, "project_manager_id") === userId),
    deliveryOrders: rows.deliveryOrders.filter(
      (row) => getString(row, "created_by") === userId || recipientOrderIds.has(getString(row, "id") ?? "")
    ),
    // getOpenReminders' "mine": the ones I'm in charge of, or — never assigned
    // to anyone — the ones I made.
    reminders: rows.reminders.filter(
      (r) => r.assigned_to === userId || (!r.assigned_to && r.created_by === userId)
    ),
  };
}

/**
 * The calendar page's feeds: mine, and — for the back office (`canSeeAll`) —
 * everyone's, for its שלי / הכל switch. Everyone's is read once and mine is
 * picked out of it (getScheduleEntries' "mine" rules): the page used to read
 * the whole feed twice, about 16 reads on every opening.
 */
export async function getCalendarFeeds(
  supabase: SupabaseClient,
  { userId, canSeeAll }: { userId: string; canSeeAll: boolean }
): Promise<{ mine: CalendarEntry[]; all: CalendarEntry[] | null }> {
  if (!canSeeAll) return { mine: await getScheduleEntries(supabase, { scope: "mine", userId }), all: null };
  const [everyone, recipientOrderIds, snoozed] = await Promise.all([
    readScheduleRows(supabase, { scope: "all", userId }),
    myRecipientOrderIds(supabase, userId),
    snoozedTasks(supabase, userId),
  ]);
  const names = await resolveScheduleNames(supabase, everyone);
  const mine = mineOf(everyone, userId, new Set(recipientOrderIds), snoozed);
  return { mine: buildScheduleEntries(mine, names, "mine"), all: buildScheduleEntries(everyone, names, "all") };
}
