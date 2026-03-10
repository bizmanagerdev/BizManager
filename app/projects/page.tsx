import { requireProfile } from "@/lib/auth/requireProfile";
import AppShell from "@/components/layout/AppShell";
import ProjectsClient from "@/app/projects/ProjectsClient";
import ProjectsCalendar from "@/app/projects/ProjectsCalendar";
import ProjectsTabsNav from "@/app/projects/ProjectsTabsNav";

type Row = Record<string, unknown>;

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const { tab } = (await searchParams) ?? {};
  const activeTab = tab === "calendar" ? "calendar" : "list";

  const { profile, supabase } = await requireProfile();

  const [{ data, error }, { data: users }, { data: customers }] = await Promise.all([
    supabase
      .from("project_dashboard_view")
      .select(
        "id,name,status,project_type,start_date,end_date,agreed_base_price,actual_price,customer_id,customer_name,project_manager_id,project_manager_name,created_at,updated_at,total_expenses,gross_profit,total_tasks,completed_tasks,open_tasks"
      )
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase.from("users").select("id,full_name,email,active").limit(500),
    supabase.from("customers").select("id,name,name_for_invoice,phone,email").limit(1000),
  ]);

  const rows = (data ?? []) as Row[];

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

  const customerOptions = (customers ?? [])
    .map((row: Row) => {
      const id = typeof row?.id === "string" ? row.id : "";
      const name =
        typeof row?.name === "string" && row.name.trim()
          ? row.name.trim()
          : typeof row?.name_for_invoice === "string" && row.name_for_invoice.trim()
            ? row.name_for_invoice.trim()
            : "";
      const phone = typeof row?.phone === "string" ? row.phone : null;
      const email = typeof row?.email === "string" ? row.email : null;
      return { id, label: name, phone, email };
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

  const customerOptionsFinal =
    customerOptions.length > 0
      ? customerOptions
      : Array.from(new Map(fallbackCustomers.map((row) => [row.id, row])).values());

  const managerOptions = (users ?? [])
    .map((row: Row) => {
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
          <ProjectsClient
            initialProjects={rows}
            customerOptions={customerOptionsFinal}
            managerOptions={managerOptions}
            currentUserId={profile.id}
          />
        )}
      </div>
    </AppShell>
  );
}

