import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export type CalendarEntryKind = "project" | "task";

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

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function compareNullableDates(a: string | null, b: string | null) {
  if (a && b) return a.localeCompare(b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

export async function getScheduleEntries(supabase: SupabaseClient): Promise<CalendarEntry[]> {
  const [{ data: projectRows, error: projectsError }, { data: taskRows, error: tasksError }] =
    await Promise.all([
      supabase
        .from("project_dashboard_view")
        .select("id,name,customer_name,start_date,end_date,status")
        .order("updated_at", { ascending: false })
        .range(0, 499),
      supabase
        .from("task_overview_view")
        .select("task_id,subject,status,priority,due_date,project_name,assigned_user_name")
        .in("status", ["todo", "in_progress", "blocked"])
        .order("due_date", { ascending: true })
        .range(0, 499),
    ]);

  if (projectsError) throw projectsError;
  if (tasksError) throw tasksError;

  const projectEntries = ((projectRows ?? []) as Row[])
    .map((row) => ({
      id: getString(row, "id") ?? "",
      kind: "project" as const,
      title: getString(row, "name") ?? "פרויקט",
      subtitle: getString(row, "customer_name") ?? "ללא לקוח",
      href: `/projects/${getString(row, "id") ?? ""}`,
      startDate: getString(row, "start_date"),
      endDate: getString(row, "end_date"),
      status: getString(row, "status"),
      priority: null,
    }))
    .filter((row) => row.id && row.startDate);

  const taskEntries = ((taskRows ?? []) as Row[])
    .map((row) => {
      const taskId = getString(row, "task_id") ?? "";
      const projectName = getString(row, "project_name");
      const assignee = getString(row, "assigned_user_name");
      const subtitleParts = [projectName, assignee].filter(
        (value): value is string => Boolean(value && value.trim())
      );

      return {
        id: taskId,
        kind: "task" as const,
        title: getString(row, "subject") ?? "משימה",
        subtitle: subtitleParts.join(" • ") || "ללא שיוך",
        href: `/tasks/${taskId}`,
        startDate: getString(row, "due_date"),
        endDate: getString(row, "due_date"),
        status: getString(row, "status"),
        priority: getString(row, "priority"),
      };
    })
    .filter((row) => row.id && row.startDate);

  return [...taskEntries, ...projectEntries].sort((a, b) => {
    const byStart = compareNullableDates(a.startDate, b.startDate);
    if (byStart !== 0) return byStart;
    if (a.kind !== b.kind) return a.kind === "task" ? -1 : 1;
    return a.title.localeCompare(b.title, "he");
  });
}

