import type { SupabaseClient } from "@supabase/supabase-js";
import { translateToArabic } from "@/lib/i18n/translateToHebrew";
import type { Locale } from "@/lib/i18n/types";

type Row = Record<string, unknown>;

const OPEN_TASK_STATUSES = ["todo", "in_progress", "blocked"];

export type DashboardTask = {
  id: string;
  subject: string;
  /** Set only when authored by a locale=ar worker — see app/api/tasks/create. */
  subject_he: string | null;
  /** Lazily cached Arabic translation of a Hebrew-authored subject. */
  subject_ar: string | null;
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
  userId: string,
  locale: Locale = "he"
): Promise<DashboardTask[]> {
  const today = new Date().toISOString().slice(0, 10);

  // Tasks I own (assigned_user_id) or that I was added to as a member.
  const { data: memberRows } = await supabase
    .from("task_members")
    .select("task_id")
    .eq("user_id", userId)
    .range(0, 999);
  const memberTaskIds = [
    ...new Set(
      ((memberRows ?? []) as Row[]).map((r) => getString(r, "task_id")).filter((v): v is string => Boolean(v))
    ),
  ];

  let tasksQuery = supabase
    .from("tasks")
    .select("id,subject,subject_he,subject_ar,due_date,priority,status,project_id")
    .in("status", OPEN_TASK_STATUSES)
    // Newest tasks first, so a task just added from the dashboard lands at the top
    // of "המשימות שלי" rather than being buried at the end.
    .order("created_at", { ascending: false })
    .range(0, 299);
  tasksQuery =
    memberTaskIds.length > 0
      ? tasksQuery.or(`assigned_user_id.eq.${userId},id.in.(${memberTaskIds.join(",")})`)
      : tasksQuery.eq("assigned_user_id", userId);

  const { data, error } = await tasksQuery;

  if (error || !data) return [];
  const rows = data as Row[];

  // An Arabic-locale viewer reading a task NOT authored by an Arabic worker
  // (subject_he unset — see app/api/tasks/create) gets it translated here,
  // cached back onto the row so future loads don't re-call OpenAI. Same
  // pattern as loadTasksBoard's board-level version of this.
  if (locale === "ar") {
    const needsTranslation = rows.filter(
      (r) => !getString(r, "subject_he") && !getString(r, "subject_ar") && getString(r, "subject")
    );
    if (needsTranslation.length > 0) {
      await Promise.all(
        needsTranslation.map(async (r) => {
          const translated = await translateToArabic(getString(r, "subject") ?? "");
          if (!translated) return;
          r.subject_ar = translated;
          await supabase.from("tasks").update({ subject_ar: translated }).eq("id", getString(r, "id") ?? "");
        })
      );
    }
  }

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
      subject_he: getString(t, "subject_he"),
      subject_ar: getString(t, "subject_ar"),
      due_date: due,
      priority: getString(t, "priority"),
      status: getString(t, "status"),
      project_name: projectId ? projectNameById.get(projectId) ?? null : null,
      overdue: due !== null && due.slice(0, 10) < today,
    };
  });
}

/**
 * How many of MY open tasks (assigned to me, or that I was added to as a member)
 * are overdue — i.e. due strictly before today. "Mine" matches getMyTasks, so the
 * alert badge agrees with the "/tasks?scope=mine" view it links to. Any failure
 * resolves to 0 (graceful degradation).
 */
export async function countMyOverdueTasks(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const todayIso = new Date().toISOString().slice(0, 10);

  const { data: memberRows } = await supabase
    .from("task_members")
    .select("task_id")
    .eq("user_id", userId)
    .range(0, 999);
  const memberTaskIds = [
    ...new Set(
      ((memberRows ?? []) as Row[]).map((r) => getString(r, "task_id")).filter((v): v is string => Boolean(v))
    ),
  ];

  let query = supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .in("status", OPEN_TASK_STATUSES)
    .not("due_date", "is", null)
    .lt("due_date", todayIso);
  query =
    memberTaskIds.length > 0
      ? query.or(`assigned_user_id.eq.${userId},id.in.(${memberTaskIds.join(",")})`)
      : query.eq("assigned_user_id", userId);

  const { count, error } = await query;
  return !error && typeof count === "number" ? count : 0;
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
