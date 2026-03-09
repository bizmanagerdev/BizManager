import { requireProfile } from "@/lib/auth/requireProfile";
import AppShell from "@/components/layout/AppShell";
import ProjectsClient from "@/app/projects/ProjectsClient";

type Row = Record<string, unknown>;

export default async function ProjectsPage() {
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
    supabase.from("customers").select("id,name").limit(500),
  ]);

  const customerOptions = (customers ?? [])
    .map((row: Row) => ({
      id: typeof row?.id === "string" ? row.id : "",
      label: typeof row?.name === "string" && row.name.trim() ? row.name : "",
    }))
    .filter((row: { id: string; label: string }) => row.id && row.label);

  const fallbackCustomers = (data ?? [])
    .map((row: Row) => ({
      id: typeof row?.customer_id === "string" ? row.customer_id : "",
      label:
        typeof row?.customer_name === "string" && row.customer_name.trim()
          ? row.customer_name
          : "",
    }))
    .filter((row: { id: string; label: string }) => row.id && row.label);

  const customerOptionsFinal =
    customerOptions.length > 0
      ? customerOptions
      : Array.from(new Map(fallbackCustomers.map((row: { id: string; label: string }) => [row.id, row])).values());

  const managerOptions = (users ?? [])
    .map((row: Row) => {
      const fullName =
        typeof row?.full_name === "string" && row.full_name.trim()
          ? row.full_name.trim()
          : null;
      const email =
        typeof row?.email === "string" && row.email.trim() ? row.email.trim() : null;
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
          <p className="text-muted-foreground text-sm">
            ניהול פרויקטים לוגיסטיים, שיפוצים ואירועים
          </p>
        </div>

        {error ? (
          <div className="text-destructive text-sm">
            שגיאה בטעינת פרויקטים: {error.message}
          </div>
        ) : (
          <ProjectsClient
            initialProjects={(data ?? []) as Row[]}
            customerOptions={customerOptionsFinal}
            managerOptions={managerOptions}
          />
        )}
      </div>
    </AppShell>
  );
}
