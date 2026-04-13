import Link from "next/link";
import { requireProfile } from "@/lib/auth/requireProfile";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import ProjectsClient from "@/app/projects/ProjectsClient";
import ProjectsCalendar from "@/app/projects/ProjectsCalendar";
import ProjectsTabsNav from "@/app/projects/ProjectsTabsNav";
import { applyEffectiveProjectDashboardRows } from "@/lib/projects/effectiveDashboard";

type Row = Record<string, unknown>;

const PROJECTS_PAGE_SIZE = 50;
const OPTIONS_PAGE_SIZE = 50;

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function parsePage(value: string | undefined) {
  const page = Number(value ?? "1");
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function buildProjectsHref(page: number, activeTab: string, customerId: string | null) {
  const params = new URLSearchParams();
  if (activeTab === "calendar") params.set("tab", "calendar");
  if (customerId) params.set("customer_id", customerId);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/projects?${query}` : "/projects";
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; page?: string; customer_id?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const activeTab = params.tab === "calendar" ? "calendar" : "list";
  const page = parsePage(params.page);
  const customerId =
    typeof params.customer_id === "string" && params.customer_id.trim()
      ? params.customer_id.trim()
      : null;
  const from = (page - 1) * PROJECTS_PAGE_SIZE;
  const to = page * PROJECTS_PAGE_SIZE - 1;

  const { profile, supabase } = await requireProfile();

  const [
    { data, error, count },
    { data: users },
    { data: customers },
  ] = await Promise.all([
    (() => {
      let query = supabase
        .from("project_dashboard_view")
        .select(
          "id,name,status,project_type,start_date,end_date,agreed_base_price,actual_price,customer_id,customer_name,project_manager_id,project_manager_name,created_at,updated_at,total_expenses,gross_profit,total_tasks,completed_tasks,open_tasks",
          { count: "estimated" }
        )
        .order("updated_at", { ascending: false });
      if (customerId) query = query.eq("customer_id", customerId);
      return query.range(from, to);
    })(),
    supabase
      .from("users")
      .select("id,full_name,email,active")
      .order("full_name", { ascending: true })
      .range(0, OPTIONS_PAGE_SIZE - 1),
    supabase
      .from("customer_overview_view")
      .select("customer_id,customer_name,phone,email")
      .order("customer_name", { ascending: true })
      .range(0, OPTIONS_PAGE_SIZE - 1),
  ]);

  const rows = await applyEffectiveProjectDashboardRows(supabase, (data ?? []) as Row[]);

  const scheduleRows = rows
    .map((row) => ({
      id: getString(row, "id") ?? "",
      name: getString(row, "name") ?? "פרויקט",
      customerName: getString(row, "customer_name") ?? "-",
      startDate: getString(row, "start_date"),
      endDate: getString(row, "end_date"),
      status: getString(row, "status") ?? "-",
    }))
    .filter((row) => row.id);

  const customerOptions = ((customers ?? []) as Row[])
    .map((row) => {
      const id = typeof row?.customer_id === "string" ? row.customer_id : "";
      const label = typeof row?.customer_name === "string" ? row.customer_name.trim() : "";
      const phone = typeof row?.phone === "string" ? row.phone : null;
      const email = typeof row?.email === "string" ? row.email : null;
      return { id, label, phone, email };
    })
    .filter((row: { id: string; label: string }) => row.id && row.label);

  const fallbackCustomers = rows
    .map((row: Row) => ({
      id: typeof row?.customer_id === "string" ? row.customer_id : "",
      label:
        typeof row?.customer_name === "string" && row.customer_name.trim() ? row.customer_name : "",
      phone: null,
      email: null,
    }))
    .filter((row: { id: string; label: string }) => row.id && row.label);

  const customerOptionsFinal = Array.from(
    new Map([...customerOptions, ...fallbackCustomers].map((row) => [row.id, row])).values()
  );

  const managerOptions = ((users ?? []) as Row[])
    .map((row) => {
      const fullName =
        typeof row?.full_name === "string" && row.full_name.trim() ? row.full_name.trim() : null;
      const email = typeof row?.email === "string" && row.email.trim() ? row.email.trim() : null;
      return {
        id: typeof row?.id === "string" ? row.id : "",
        label: fullName ?? email ?? "",
        active: row?.active,
      };
    })
    .filter(
      (row: { id: string; label: string; active: unknown }) =>
        row.id && row.label && row.active !== false
    )
    .map((row: { id: string; label: string }) => ({ id: row.id, label: row.label }));

  const totalCount = typeof count === "number" ? count : rows.length;
  const hasPreviousPage = page > 1;
  const hasNextPage = typeof count === "number" ? to + 1 < count : rows.length === PROJECTS_PAGE_SIZE;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">פרויקטים</h1>
          <p className="text-muted-foreground text-sm">ניהול פרויקטים ותפעול</p>
        </div>

        <ProjectsTabsNav activeTab={activeTab} />

        {error ? (
          <div className="text-destructive text-sm">שגיאה בטעינת פרויקטים: {error.message}</div>
        ) : activeTab === "calendar" ? (
          <ProjectsCalendar projects={scheduleRows} />
        ) : (
          <>
            <ProjectsClient
              initialProjects={rows}
              customerOptions={customerOptionsFinal}
              managerOptions={managerOptions}
              currentUserId={profile.id}
            />
            <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
              <div className="text-muted-foreground">
                עמוד {page} • מוצגים {rows.length} מתוך {totalCount}
              </div>
              <div className="flex gap-2">
                {hasPreviousPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildProjectsHref(page - 1, activeTab, customerId)}>הקודם</Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    הקודם
                  </Button>
                )}
                {hasNextPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildProjectsHref(page + 1, activeTab, customerId)}>הבא</Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    הבא
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
