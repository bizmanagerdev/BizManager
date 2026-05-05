import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { ensureRecurringTasksForDate } from "@/lib/recurring-tasks";
import TasksPageClient, { type TaskListItem } from "./TasksPageClient";

export const revalidate = 30;
const PAGE_SIZE = 50;

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

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function parsePage(value: string | undefined) {
  const page = Number(value ?? "1");
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function buildTasksHref(page: number) {
  return page <= 1 ? "/tasks" : `/tasks?page=${page}`;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const page = parsePage(params.page);
  const from = (page - 1) * PAGE_SIZE;
  const to = page * PAGE_SIZE - 1;

  const { profile, supabase } = await requireProfile();

  if (profile.role === "admin" || profile.role === "office") {
    await ensureRecurringTasksForDate(supabase);
  }

  const [
    tasksResult,
    projectsResult,
    propertiesResult,
    usersResult,
  ] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id,subject,status,priority,due_date,business_domain,project_id,property_id,assigned_user_id",
        { count: "estimated" }
      )
      .order("due_date", { ascending: true })
      .range(from, to),
    supabase
      .from("project_dashboard_view")
      .select("id,name,customer_name")
      .order("updated_at", { ascending: false })
      .range(0, 999),
    supabase
      .from("properties")
      .select("id,address,is_active")
      .order("address", { ascending: true })
      .range(0, 999),
    supabase
      .from("users")
      .select("id,full_name,email,active")
      .order("full_name", { ascending: true })
      .range(0, 499),
  ]);

  const tasksError = tasksResult.error?.message ?? null;
  const taskRows = (tasksResult.data ?? []) as TaskRow[];

  const tasks: TaskListItem[] = taskRows.map((row) => {
    const projectId = typeof row.project_id === "string" ? row.project_id : null;
    const propertyId = typeof row.property_id === "string" ? row.property_id : null;

    const projectName = projectId
      ? (() => {
          const match = ((projectsResult.data ?? []) as Row[]).find((p) => getString(p, "id") === projectId);
          return match ? getString(match, "name") : null;
        })()
      : null;

    const propertyName = propertyId
      ? (() => {
          const match = ((propertiesResult.data ?? []) as Row[]).find((p) => getString(p, "id") === propertyId);
          return match ? getString(match, "address") : null;
        })()
      : null;

    const assignedName = (() => {
      const userId = typeof row.assigned_user_id === "string" ? row.assigned_user_id : null;
      if (!userId) return null;
      const match = ((usersResult.data ?? []) as Row[]).find((u) => getString(u, "id") === userId);
      return match ? (getString(match, "full_name") ?? getString(match, "email")) : null;
    })();

    return {
      id: row.id,
      subject: row.subject ?? "משימה",
      status: row.status,
      priority: row.priority,
      due_date: row.due_date,
      business_domain: row.business_domain,
      project_id: row.project_id,
      property_id: row.property_id,
      project_name: projectName,
      property_name: propertyName,
      assigned_user_id: row.assigned_user_id,
      assigned_user_name: assignedName,
    };
  });

  const totalCount =
    typeof tasksResult.count === "number" ? tasksResult.count : taskRows.length;
  const hasPreviousPage = page > 1;
  const hasNextPage =
    typeof tasksResult.count === "number" ? to + 1 < tasksResult.count : taskRows.length === PAGE_SIZE;

  const prevHref = hasPreviousPage ? buildTasksHref(page - 1) : null;
  const nextHref = hasNextPage ? buildTasksHref(page + 1) : null;

  const projectOptions = ((projectsResult.data ?? []) as Row[])
    .map((p) => {
      const id = getString(p, "id") ?? "";
      const name = getString(p, "name") ?? "";
      const customerName = getString(p, "customer_name");
      const label = customerName ? `${name} (${customerName})` : name;
      return { id, label };
    })
    .filter((p) => p.id && p.label);

  const propertyOptions = ((propertiesResult.data ?? []) as Row[])
    .filter((p) => p.is_active !== false)
    .map((p) => ({ id: getString(p, "id") ?? "", label: getString(p, "address") ?? "" }))
    .filter((p) => p.id && p.label);

  const userOptions = ((usersResult.data ?? []) as Row[])
    .filter((u) => u.active !== false)
    .map((u) => ({
      id: getString(u, "id") ?? "",
      label: getString(u, "full_name") ?? getString(u, "email") ?? "",
    }))
    .filter((u) => u.id && u.label);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      {tasksError ? (
        <div className="text-destructive text-sm">שגיאה: {tasksError}</div>
      ) : (
        <TasksPageClient
          tasks={tasks}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={totalCount}
          hasPreviousPage={hasPreviousPage}
          hasNextPage={hasNextPage}
          prevHref={prevHref}
          nextHref={nextHref}
          projects={projectOptions}
          properties={propertyOptions}
          users={userOptions}
        />
      )}
    </AppShell>
  );
}
