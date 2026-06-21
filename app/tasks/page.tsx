import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { ensureRecurringTasksForDate } from "@/lib/recurring-tasks";
import { TasksTabs } from "@/components/tasks/TasksTabs";
import TasksPageClient from "./TasksPageClient";
import { loadTasksBoard } from "./loadTasks";

export const revalidate = 30;

type Row = Record<string, unknown>;

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; priority?: string; domain?: string; linked_id?: string; scope?: string }>;
}) {
  const params = (await searchParams) ?? {};

  const q = typeof params.q === "string" ? params.q.trim() : "";
  const filterPriority = typeof params.priority === "string" ? params.priority.trim() : "";
  const filterDomain = typeof params.domain === "string" ? params.domain.trim() : "";
  const filterLinkedId = typeof params.linked_id === "string" ? params.linked_id.trim() : "";

  const { profile, supabase } = await requireProfile();
  const canSeeAll = profile.role === "admin" || profile.role === "office";
  // Admin/office default to "all"; they can opt into "mine". Workers are always
  // restricted to their own tasks (enforced again in the loader).
  const filterScope: "mine" | "all" = !canSeeAll ? "mine" : params.scope === "mine" ? "mine" : "all";

  const filters = {
    q,
    priority: filterPriority,
    domain: filterDomain,
    linkedId: filterLinkedId,
    scope: filterScope,
  };

  if (canSeeAll) {
    await ensureRecurringTasksForDate(supabase);
  }

  const [boardResult, projectsResult, propertiesResult, usersResult] = await Promise.all([
    loadTasksBoard(supabase, { filters, userId: profile.id, canSeeAll }),
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
      <div className="space-y-4">
        {/* Recurring tasks is admin/office-only — only they get the tab bar. */}
        {canSeeAll ? <TasksTabs /> : null}
        {boardResult.error ? (
          <div className="text-destructive text-sm">שגיאה: {boardResult.error}</div>
        ) : (
          <TasksPageClient
            tasks={boardResult.items}
            projects={projectOptions}
            properties={propertyOptions}
            users={userOptions}
            canSeeAll={canSeeAll}
            currentUserId={profile.id}
            initialFilters={{ q, priority: filterPriority, domain: filterDomain, linkedId: filterLinkedId, scope: filterScope }}
          />
        )}
      </div>
    </AppShell>
  );
}
