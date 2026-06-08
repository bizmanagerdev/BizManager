import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

const OPEN_TASK_STATUSES = ["todo", "in_progress", "blocked"];

export type DashboardTask = {
  id: string;
  subject: string;
  due_date: string | null;
  priority: string | null;
  status: string | null;
  project_name: string | null;
  overdue: boolean;
};

export type TaskStatusCounts = {
  todo: number;
  in_progress: number;
  blocked: number;
  done: number;
};

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

/**
 * All of my open tasks (todo / in_progress / blocked), newest-due first, with the
 * project name resolved. Powers the "המשימות שלי" panel and its tab counts. Mirrors
 * the project-name join pattern in lib/today-inbox.ts.
 */
export async function getMyTasks(
  supabase: SupabaseClient,
  userId: string
): Promise<DashboardTask[]> {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("tasks")
    .select("id,subject,due_date,priority,status,project_id")
    .eq("assigned_user_id", userId)
    .in("status", OPEN_TASK_STATUSES)
    .order("due_date", { ascending: true, nullsFirst: false })
    .range(0, 299);

  if (error || !data) return [];
  const rows = data as Row[];

  const projectIds = [
    ...new Set(
      rows.map((r) => getString(r, "project_id")).filter((v): v is string => Boolean(v))
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

  return rows.map((t) => {
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
}

/**
 * Org-wide task counts by status for the donut. Four lightweight head-count queries
 * (estimated) so we never pull the full `done` history. Back-office only — gated by
 * the caller. Any failure resolves to 0 (graceful degradation).
 */
export async function getTaskStatusCounts(
  supabase: SupabaseClient
): Promise<TaskStatusCounts> {
  const statuses: (keyof TaskStatusCounts)[] = ["todo", "in_progress", "blocked", "done"];
  const results = await Promise.all(
    statuses.map((status) =>
      supabase
        .from("tasks")
        .select("id", { count: "estimated", head: true })
        .eq("status", status)
        .then((r) => (typeof r.count === "number" ? r.count : 0), () => 0)
    )
  );
  return {
    todo: results[0],
    in_progress: results[1],
    blocked: results[2],
    done: results[3],
  };
}
