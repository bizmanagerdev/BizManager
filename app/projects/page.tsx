import { requireProfile } from "@/lib/auth/requireProfile";
import AppShell from "@/components/layout/AppShell";
import ProjectsClient from "@/app/projects/ProjectsClient";

export default async function ProjectsPage() {
  const { profile, supabase } = await requireProfile();

  const { data, error } = await supabase
    .from("project_dashboard_view")
    .select(
      "id,name,status,project_type,start_date,end_date,agreed_base_price,actual_price,customer_id,customer_name,project_manager_id,project_manager_name,created_at,updated_at,total_expenses,gross_profit,total_tasks,completed_tasks,open_tasks"
    )
    .order("updated_at", { ascending: false })
    .limit(200);

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
          <ProjectsClient initialProjects={(data ?? []) as any[]} />
        )}
      </div>
    </AppShell>
  );
}
