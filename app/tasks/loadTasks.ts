import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskListItem } from "./TasksPageClient";

type Row = Record<string, unknown>;

type TaskRow = {
  id: string;
  subject: string | null;
  status: string | null;
  priority: string | null;
  due_date: string | null;
  business_domain: string | null;
  project_id: string | null;
  property_id: string | null;
  assigned_user_id: string | null;
};

export type TasksFilters = {
  q: string;
  status: string;
  priority: string;
  domain: string;
  linkedId: string;
};

export const TASKS_PAGE_SIZE = 50;

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function uniqueIds(rows: TaskRow[], key: "project_id" | "property_id" | "assigned_user_id") {
  return [...new Set(rows.map((row) => (typeof row[key] === "string" ? (row[key] as string) : "")).filter(Boolean))];
}

export type TasksPageResult = {
  tasks: TaskListItem[];
  totalCount: number;
  hasMore: boolean;
  error: string | null;
};

/**
 * Load one page of tasks, with project / property / assignee names resolved for
 * just the rows on this page. Shared by the initial server render (page 1) and
 * the fetch-on-scroll server action (page >= 2).
 */
export async function loadTasksPage(
  supabase: SupabaseClient,
  { page, filters }: { page: number; filters: TasksFilters }
): Promise<TasksPageResult> {
  const { q, status, priority, domain, linkedId } = filters;
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const from = (safePage - 1) * TASKS_PAGE_SIZE;
  const to = safePage * TASKS_PAGE_SIZE - 1;

  let tasksQuery = supabase
    .from("tasks")
    .select(
      "id,subject,status,priority,due_date,business_domain,project_id,property_id,assigned_user_id",
      { count: "estimated" }
    )
    .order("due_date", { ascending: true });

  if (status) tasksQuery = tasksQuery.eq("status", status);
  if (priority) tasksQuery = tasksQuery.eq("priority", priority);
  if (domain) tasksQuery = tasksQuery.eq("business_domain", domain);
  if (linkedId) {
    if (domain === "logistics_projects") {
      tasksQuery = tasksQuery.eq("project_id", linkedId);
    } else if (domain === "property_management") {
      tasksQuery = tasksQuery.eq("property_id", linkedId);
    }
  }
  if (q) {
    const escaped = q.replace(/[%,]/g, " ");
    tasksQuery = tasksQuery.ilike("subject", `%${escaped}%`);
  }

  const { data, error, count } = await tasksQuery.range(from, to);
  const taskRows = (data ?? []) as TaskRow[];

  const projectIds = uniqueIds(taskRows, "project_id");
  const propertyIds = uniqueIds(taskRows, "property_id");
  const userIds = uniqueIds(taskRows, "assigned_user_id");

  const [projectsResult, propertiesResult, usersResult] = await Promise.all([
    projectIds.length
      ? supabase.from("project_dashboard_view").select("id,name").in("id", projectIds)
      : Promise.resolve({ data: [] as Row[] }),
    propertyIds.length
      ? supabase.from("properties").select("id,address").in("id", propertyIds)
      : Promise.resolve({ data: [] as Row[] }),
    userIds.length
      ? supabase.from("users").select("id,full_name,email").in("id", userIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  const projectsById = new Map(
    ((projectsResult.data ?? []) as Row[])
      .map((row) => [getString(row, "id"), getString(row, "name")] as const)
      .filter((entry): entry is readonly [string, string | null] => Boolean(entry[0]))
  );
  const propertiesById = new Map(
    ((propertiesResult.data ?? []) as Row[])
      .map((row) => [getString(row, "id"), getString(row, "address")] as const)
      .filter((entry): entry is readonly [string, string | null] => Boolean(entry[0]))
  );
  const usersById = new Map(
    ((usersResult.data ?? []) as Row[])
      .map((row) => [getString(row, "id"), getString(row, "full_name") ?? getString(row, "email")] as const)
      .filter((entry): entry is readonly [string, string | null] => Boolean(entry[0]))
  );

  const tasks: TaskListItem[] = taskRows.map((row) => {
    const projectId = typeof row.project_id === "string" ? row.project_id : null;
    const propertyId = typeof row.property_id === "string" ? row.property_id : null;
    const userId = typeof row.assigned_user_id === "string" ? row.assigned_user_id : null;
    return {
      id: row.id,
      subject: row.subject ?? "משימה",
      status: row.status,
      priority: row.priority,
      due_date: row.due_date,
      business_domain: row.business_domain,
      project_id: row.project_id,
      property_id: row.property_id,
      project_name: projectId ? projectsById.get(projectId) ?? null : null,
      property_name: propertyId ? propertiesById.get(propertyId) ?? null : null,
      assigned_user_id: row.assigned_user_id,
      assigned_user_name: userId ? usersById.get(userId) ?? null : null,
    };
  });

  const totalCount = typeof count === "number" ? count : taskRows.length;
  const hasMore = typeof count === "number" ? to + 1 < count : taskRows.length === TASKS_PAGE_SIZE;

  return { tasks, totalCount, hasMore, error: error?.message ?? null };
}
