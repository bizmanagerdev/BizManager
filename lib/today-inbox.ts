import type { SupabaseClient } from "@supabase/supabase-js";
import { getOpenReminders, type Reminder } from "@/lib/communications";
import { getPaymentsDueToday, type PaymentDueToday } from "@/lib/collections";
import type { UserProfile } from "@/lib/auth/requireProfile";

type Row = Record<string, unknown>;

export type TodayTask = {
  id: string;
  subject: string;
  due_date: string | null;
  priority: string | null;
  status: string | null;
  project_name: string | null;
  overdue: boolean;
};

export type TodayInboxData = {
  tasks: TodayTask[];
  reminders: Reminder[];
  payments: PaymentDueToday[];
};

const OPEN_TASK_STATUSES = ["todo", "in_progress", "blocked"];

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

/**
 * Personal "today" digest shared by the dashboard and alerts page:
 *   - my open tasks due by today (assigned to me),
 *   - my pending reminders due by today,
 *   - payments to collect today (back-office only — payments aren't user-owned).
 * Everything is filtered to "today or earlier" so overdue items surface too.
 */
export async function getTodayInboxData(
  supabase: SupabaseClient,
  profile: Pick<UserProfile, "id" | "role">
): Promise<TodayInboxData> {
  const today = new Date().toISOString().slice(0, 10);
  const canSeeAll = profile.role === "admin" || profile.role === "office";

  const [tasksRes, reminders, payments] = await Promise.all([
    supabase
      .from("tasks")
      .select("id,subject,due_date,priority,status,project_id")
      .eq("assigned_user_id", profile.id)
      .in("status", OPEN_TASK_STATUSES)
      .not("due_date", "is", null)
      .order("due_date", { ascending: true })
      .range(0, 199),
    getOpenReminders(supabase, { scope: "mine", userId: profile.id }).catch(() => [] as Reminder[]),
    canSeeAll
      ? getPaymentsDueToday(supabase, today).catch(() => [] as PaymentDueToday[])
      : Promise.resolve([] as PaymentDueToday[]),
  ]);

  // due_date may be a date or a timestamp — compare on the date portion in JS so
  // we don't trip over column-type/timezone differences.
  const taskRows = ((tasksRes.data ?? []) as Row[]).filter((t) => {
    const d = getString(t, "due_date");
    return d !== null && d.slice(0, 10) <= today;
  });

  const projectIds = [
    ...new Set(
      taskRows.map((t) => getString(t, "project_id")).filter((v): v is string => Boolean(v))
    ),
  ];
  const projectsRes = projectIds.length
    ? await supabase.from("projects").select("id,name").in("id", projectIds)
    : { data: [] as Row[] };
  const projectNameById = new Map(
    ((projectsRes.data ?? []) as Row[])
      .map((r) => [getString(r, "id"), getString(r, "name")] as const)
      .filter((e): e is readonly [string, string | null] => Boolean(e[0]))
  );

  const tasks: TodayTask[] = taskRows.map((t) => {
    const due = getString(t, "due_date");
    const projectId = getString(t, "project_id");
    return {
      id: getString(t, "id") ?? "",
      subject: getString(t, "subject") ?? "משימה",
      due_date: due,
      priority: getString(t, "priority"),
      status: getString(t, "status"),
      project_name: projectId ? projectNameById.get(projectId) ?? null : null,
      overdue: due !== null && due.slice(0, 10) < today,
    };
  });

  const dueReminders = reminders.filter((r) => r.remind_at.slice(0, 10) <= today);

  return { tasks, reminders: dueReminders, payments };
}
