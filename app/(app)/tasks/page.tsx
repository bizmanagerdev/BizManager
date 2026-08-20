import AppShell from "@/components/layout/AppShell";
import PageAlertBar from "@/components/reminders/PageAlertBar";
import { requireProfile } from "@/lib/auth/requireProfile";
import { ensureRecurringTasksForDate } from "@/lib/recurring-tasks";
import { t } from "@/lib/i18n/t";
import { commonDict } from "@/lib/i18n/dictionaries/common";
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
  // Everyone defaults to their own tasks ("mine" = assigned / member / creator).
  // Admin/office can opt into "all"; workers are always restricted (re-enforced
  // in the loader).
  const filterScope: "mine" | "all" = !canSeeAll ? "mine" : params.scope === "all" ? "all" : "mine";

  const filters = {
    q,
    priority: filterPriority,
    domain: filterDomain,
    linkedId: filterLinkedId,
    scope: filterScope,
  };

  // Run the recurring-tasks write concurrently with the reads (awaited below)
  // instead of as a blocking pre-step — it no longer adds a serial round-trip
  // wave ahead of the board load. Trade-off: on the rare day a template first
  // fires, its tasks appear on the next load.
  const recurringTasksPromise = canSeeAll
    ? ensureRecurringTasksForDate(supabase).catch(() => undefined)
    : Promise.resolve(undefined);

  const [boardResult, projectsResult, propertiesResult, customersResult, usersResult] = await Promise.all([
    loadTasksBoard(supabase, { filters, userId: profile.id, canSeeAll, locale: profile.locale }),
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
    // Active customers for the "linked customer" picker (searchable, A–Z). The card
    // display resolves the name/phone via a direct id query, not this list.
    supabase
      .from("customers")
      .select("id,name,phone,active")
      .eq("active", true)
      .order("name", { ascending: true })
      .range(0, 1999),
    supabase
      .from("users")
      .select("id,full_name,email,active")
      // Only workers with system access can be assigned / added as task members;
      // no-access workers (payroll-only, can't log in) are excluded from the pickers.
      .neq("role", "worker_no_access")
      .order("full_name", { ascending: true })
      .range(0, 499),
  ]);

  // Chosen avatar colors — separate, tolerant query so a missing column (before
  // db/sql/add_user_avatar_color.sql runs) can't break the user list.
  const colorsResult = await supabase.from("users").select("id,avatar_color").range(0, 499);
  const colorById = new Map<string, string>();
  for (const row of (colorsResult.data ?? []) as Row[]) {
    const id = getString(row, "id");
    const color = getString(row, "avatar_color");
    if (id && color) colorById.set(id, color);
  }

  await recurringTasksPromise;

  const projectRows = (projectsResult.data ?? []) as Row[];
  const propertyRows = (propertiesResult.data ?? []) as Row[];
  const customerRows = (customersResult.data ?? []) as Row[];
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

  const customerOptions = customerRows
    .map((c) => {
      const id = getString(c, "id") ?? "";
      const name = getString(c, "name") ?? "";
      const phone = getString(c, "phone");
      // Phone in the label so the searchable picker matches on it too.
      const label = phone ? `${name} · ${phone}` : name;
      return { id, label };
    })
    .filter((c) => c.id && c.label);

  const userOptions = userRows
    .filter((u) => u.active !== false)
    .map((u) => {
      const id = getString(u, "id") ?? "";
      return {
        id,
        label: getString(u, "full_name") ?? getString(u, "email") ?? "",
        color: colorById.get(id) ?? null,
      };
    })
    .filter((u) => u.id && u.label);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        <PageAlertBar keys={["task_overdue", "task_due_soon"]} locale={profile.locale} />
        {/* The tab bar is rendered by TasksPageClient on this page — the board's
            search / filters / + ride the END of that same row on desktop, and
            they're client-owned. Phones get no tab bar at all: "משימות קבועות"
            is a button in the header strip there (the recurring page keeps its
            tabs, so there's always a way back). */}
        {boardResult.error ? (
          <div className="text-destructive text-sm">
            {t(commonDict, profile.locale, "error")}: {boardResult.error}
          </div>
        ) : (
          <TasksPageClient
            tasks={boardResult.items}
            projects={projectOptions}
            properties={propertyOptions}
            customers={customerOptions}
            users={userOptions}
            canSeeAll={canSeeAll}
            currentUserId={profile.id}
            locale={profile.locale}
            initialFilters={{ q, priority: filterPriority, domain: filterDomain, linkedId: filterLinkedId, scope: filterScope }}
          />
        )}
      </div>
    </AppShell>
  );
}
