import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { ensureRecurringTasksForDate } from "@/lib/recurring-tasks";
import TasksPageClient from "./TasksPageClient";
import { loadTasksPage } from "./loadTasks";

export const revalidate = 30;

type Row = Record<string, unknown>;

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; status?: string; priority?: string; domain?: string; linked_id?: string; scope?: string }>;
}) {
  const params = (await searchParams) ?? {};

  const q = typeof params.q === "string" ? params.q.trim() : "";
  const filterStatus = typeof params.status === "string" ? params.status.trim() : "";
  const filterPriority = typeof params.priority === "string" ? params.priority.trim() : "";
  const filterDomain = typeof params.domain === "string" ? params.domain.trim() : "";
  const filterLinkedId = typeof params.linked_id === "string" ? params.linked_id.trim() : "";

  const { profile, supabase } = await requireProfile();
  const canSeeAll = profile.role === "admin" || profile.role === "office";
  // Default to "mine"; only admin/office may opt into "all".
  const filterScope: "mine" | "all" = canSeeAll && params.scope === "all" ? "all" : "mine";

  const filters = {
    q,
    status: filterStatus,
    priority: filterPriority,
    domain: filterDomain,
    linkedId: filterLinkedId,
    scope: filterScope,
  };

  if (canSeeAll) {
    await ensureRecurringTasksForDate(supabase);
  }

  const [
    tasksResult,
    projectsResult,
    propertiesResult,
    usersResult,
  ] = await Promise.all([
    loadTasksPage(supabase, { page: 1, filters, userId: profile.id, canSeeAll }),
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

  const tasksError = tasksResult.error;
  const tasks = tasksResult.tasks;
  const totalCount = tasksResult.totalCount;
  const hasMore = tasksResult.hasMore;
  const projectRows = (projectsResult.data ?? []) as Row[];
  const propertyRows = (propertiesResult.data ?? []) as Row[];
  const userRows = (usersResult.data ?? []) as Row[];

  const projectOptions = projectRows
    .map((p) => {
      const id = getString(p, "id") ?? "";
      const name = getString(p, "name") ?? "";
      const customerName = getString(p, "customer_name");
      const label = customerName ? `${name} (${customerName})` : name;
      return { id, label };
    })
    .filter((p) => p.id && p.label);

  const propertyOptions = propertyRows
    .filter((p) => p.is_active !== false)
    .map((p) => ({ id: getString(p, "id") ?? "", label: getString(p, "address") ?? "" }))
    .filter((p) => p.id && p.label);

  const userOptions = userRows
    .filter((u) => u.active !== false)
    .map((u) => ({
      id: getString(u, "id") ?? "",
      label: getString(u, "full_name") ?? getString(u, "email") ?? "",
    }))
    .filter((u) => u.id && u.label);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      {tasksError ? (
        <div className="text-destructive text-sm">שגיאה: {tasksError}</div>
      ) : (
        <TasksPageClient
          tasks={tasks}
          initialHasMore={hasMore}
          totalCount={totalCount}
          projects={projectOptions}
          properties={propertyOptions}
          users={userOptions}
          canSeeAll={canSeeAll}
          initialFilters={{ q, status: filterStatus, priority: filterPriority, domain: filterDomain, linkedId: filterLinkedId, scope: filterScope }}
        />
      )}
    </AppShell>
  );
}
