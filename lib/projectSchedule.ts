import type { SupabaseClient } from "@supabase/supabase-js";
import { getOpenReminders, actionTypeLabel } from "@/lib/communications";
import { getOrderStatusLabel } from "@/lib/ui/status-colors";

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
  let tasksQuery = supabase
    .from("tasks")
    .select("id,subject,status,priority,due_date,due_time,assigned_user_id,project_id")
    .in("status", OPEN_TASK_STATUSES)
    .order("due_date", { ascending: true })
    .range(0, 499);
  if (scope === "mine") tasksQuery = tasksQuery.eq("assigned_user_id", userId);

  let projectsQuery = supabase
    .from("projects")
    .select("id,name,status,start_date,end_date,project_manager_id,customer_id")
    .order("start_date", { ascending: true })
    .range(0, 499);
  if (scope === "mine") projectsQuery = projectsQuery.eq("project_manager_id", userId);

  let deliveriesQuery = supabase
    .from("orders")
    .select("id,customer_id,status,requested_delivery_date,created_by")
    .not("requested_delivery_date", "is", null)
    .not("status", "in", `(${CLOSED_ORDER_STATUSES.join(",")})`)
    .order("requested_delivery_date", { ascending: true })
    .range(0, 499);
  // "Mine" = orders I created, PLUS orders someone explicitly picked me as a
  // recipient for (order_delivery_recipients) — e.g. a driver who didn't
  // create the order but was told to see it on their own calendar. That lookup
  // only gates deliveriesQuery's filter, so it must not block tasksQuery /
  // projectsQuery / reminders from firing at the same time — folded into one
  // async step below that runs concurrently with the other three.
  const deliveriesPromise = (async () => {
    if (scope === "mine") {
      const { data: recipientRows } = await supabase
        .from("order_delivery_recipients")
        .select("order_id")
        .eq("user_id", userId);
      const recipientOrderIds = [
        ...new Set(
          ((recipientRows ?? []) as Row[])
            .map((r) => getString(r, "order_id"))
            .filter((id): id is string => Boolean(id))
        ),
      ];
      deliveriesQuery =
        recipientOrderIds.length > 0
          ? deliveriesQuery.or(`created_by.eq.${userId},id.in.(${recipientOrderIds.join(",")})`)
          : deliveriesQuery.eq("created_by", userId);
    }
    return deliveriesQuery;
  })();

  const [
    { data: taskRows, error: tasksError },
    { data: projectRows, error: projectsError },
    { data: deliveryOrderRows, error: deliveriesError },
    reminders,
  ] = await Promise.all([
    tasksQuery,
    projectsQuery,
    deliveriesPromise,
    getOpenReminders(supabase, { scope, userId, limit: 500 }),
  ]);

  if (tasksError) throw tasksError;
  if (projectsError) throw projectsError;
  if (deliveriesError) throw deliveriesError;

  const tasks = (taskRows ?? []) as Row[];
  const projects = (projectRows ?? []) as Row[];
  const deliveryOrders = (deliveryOrderRows ?? []) as Row[];

  // Resolve names: task→project, task→assignee, project/order→customer.
  const taskProjectIds = uniqueIds(tasks, "project_id");
  const taskUserIds = uniqueIds(tasks, "assigned_user_id");
  const customerIds = [
    ...new Set([...uniqueIds(projects, "customer_id"), ...uniqueIds(deliveryOrders, "customer_id")]),
  ];

  const empty = Promise.resolve({ data: [] as Row[] });
  const [projectNamesRes, userNamesRes, customerNamesRes] = await Promise.all([
    taskProjectIds.length
      ? supabase.from("projects").select("id,name").in("id", taskProjectIds)
      : empty,
    taskUserIds.length
      ? supabase.from("users").select("id,full_name,email").in("id", taskUserIds)
      : empty,
    customerIds.length
      ? supabase.from("customers").select("id,name").in("id", customerIds)
      : empty,
  ]);

  const projectNameById = new Map(
    ((projectNamesRes.data ?? []) as Row[])
      .map((r) => [getString(r, "id"), getString(r, "name")] as const)
      .filter((e): e is readonly [string, string | null] => Boolean(e[0]))
  );
  const userNameById = new Map(
    ((userNamesRes.data ?? []) as Row[])
      .map((r) => [getString(r, "id"), getString(r, "full_name") ?? getString(r, "email")] as const)
      .filter((e): e is readonly [string, string | null] => Boolean(e[0]))
  );
  const customerNameById = new Map(
    ((customerNamesRes.data ?? []) as Row[])
      .map((r) => [getString(r, "id"), getString(r, "name")] as const)
      .filter((e): e is readonly [string, string | null] => Boolean(e[0]))
  );

  const taskEntries: CalendarEntry[] = tasks
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

  const reminderEntries: CalendarEntry[] = reminders
    .map((r) => {
      const day = r.remind_at ? r.remind_at.slice(0, 10) : null;
      // Same detail the תזכורות panel shows: a task-linked reminder reads as its
      // task subject (+ "משימה"), otherwise the content / customer with the
      // action-type label — never a bare "תזכורת — ללא לקוח".
      const timeMatch = r.remind_at ? /T(\d{2}:\d{2})/.exec(r.remind_at) : null;
      const time = timeMatch ? timeMatch[1] : null;
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
        href: r.task_id ? `/tasks/${r.task_id}` : "/collections",
        startDate: day,
        endDate: day,
        status: r.status,
        priority: null,
      };
    })
    .filter((row) => row.id && row.startDate);

  const projectEntries: CalendarEntry[] = projects
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

  const deliveryEntries: CalendarEntry[] = deliveryOrders
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

  return [...taskEntries, ...reminderEntries, ...projectEntries, ...deliveryEntries].sort((a, b) => {
    const byStart = compareNullableDates(a.startDate, b.startDate);
    if (byStart !== 0) return byStart;
    if (a.kind !== b.kind) return a.kind === "task" ? -1 : 1;
    return a.title.localeCompare(b.title, "he");
  });
}
