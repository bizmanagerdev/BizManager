import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import TaskDetailClient from "@/app/tasks/[id]/TaskDetailClient";

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ returnTo?: string }>;
}) {
  const { id } = await params;
  const { returnTo } = (await searchParams) ?? {};
  const { profile, supabase } = await requireProfile();

  const { data: overview, error: overviewError } = await supabase
    .from("task_overview_view")
    .select(
      "task_id,subject,status,priority,due_date,project_id,project_name,assigned_user_id,assigned_user_name,created_at,updated_at"
    )
    .eq("task_id", id)
    .maybeSingle();

  const { data: taskRow, error: taskError } = await supabase
    .from("tasks")
    .select("id,description,notes,project_id,customer_id")
    .eq("id", id)
    .maybeSingle();

  const projectId =
    typeof (taskRow as any)?.project_id === "string"
      ? ((taskRow as any).project_id as string)
      : typeof (overview as any)?.project_id === "string"
        ? ((overview as any).project_id as string)
        : null;

  const { data: projectOverview } = projectId
    ? await supabase
        .from("project_overview_view")
        .select("id,name,customer_name")
        .eq("id", projectId)
        .maybeSingle()
    : { data: null as any };

  const error =
    overviewError?.message ?? taskError?.message ?? null;

  const safeReturnTo =
    typeof returnTo === "string" && returnTo.startsWith("/") ? returnTo : null;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">משימות</h1>
          <Link
            className="text-sm text-primary"
            href={safeReturnTo ?? "/tasks"}
          >
            {safeReturnTo ? "חזרה לפרויקט" : "חזרה לרשימת משימות"}
          </Link>
        </div>

        {error ? (
          <div className="text-destructive text-sm">שגיאה: {error}</div>
        ) : !overview ? (
          <div className="text-muted-foreground">משימה לא נמצאה.</div>
        ) : (
          <TaskDetailClient
            taskId={overview.task_id}
            subject={overview.subject ?? "משימה"}
            status={overview.status ?? "todo"}
            priority={overview.priority ?? null}
            dueDate={overview.due_date ?? null}
            assignedUserName={overview.assigned_user_name ?? null}
            projectName={(projectOverview as any)?.name ?? overview.project_name ?? null}
            customerName={(projectOverview as any)?.customer_name ?? null}
            description={(taskRow as any)?.description ?? null}
            notes={(taskRow as any)?.notes ?? null}
          />
        )}
      </div>
    </AppShell>
  );
}
