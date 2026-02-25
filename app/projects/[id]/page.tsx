import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import ProjectTabsClient from "@/app/projects/[id]/ProjectTabsClient";
import { Badge } from "@/components/ui/badge";

function projectStatusVariant(status: string) {
  switch (status) {
    case "planned":
      return "secondary" as const;
    case "active":
      return "default" as const;
    case "on_hold":
      return "warning" as const;
    case "completed":
      return "success" as const;
    case "cancelled":
      return "outline" as const;
    default:
      return "outline" as const;
  }
}

function projectStatusLabel(status: string) {
  switch (status) {
    case "planned":
      return "מתוכנן";
    case "active":
      return "פעיל";
    case "on_hold":
      return "בהמתנה";
    case "completed":
      return "הושלם";
    case "cancelled":
      return "בוטל";
    default:
      return status;
  }
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile, supabase } = await requireProfile();

  const { data: overview, error: overviewError } = await supabase
    .from("project_overview_view")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  const { data: financials } = await supabase
    .from("project_financials_view")
    .select("id,agreed_base_price,actual_price,total_expenses,gross_profit")
    .eq("id", id)
    .maybeSingle();

  const { data: tasks } = await supabase
    .from("project_task_progress_view")
    .select("project_id,total_tasks,completed_tasks,open_tasks")
    .eq("project_id", id)
    .maybeSingle();

  const { data: projectTasks, error: projectTasksError } = await supabase
    .from("task_overview_view")
    .select("*")
    .eq("project_id", id)
    .limit(200);

  const { data: assignableUsers, error: assignableUsersError } = await supabase
    .from("users")
    .select("id,full_name,email,role,active")
    .order("full_name", { ascending: true })
    .limit(200);

  const { data: expenseSummary, error: expenseSummaryError } = await supabase
    .from("project_expenses_summary_view")
    .select(
      "project_id,expense_count,total_expenses,expenses_included,expenses_billed"
    )
    .eq("project_id", id)
    .maybeSingle();

  const { data: projectExpenses, error: projectExpensesError } = await supabase
    .from("project_expenses")
    .select("id,project_id,expense_id,included_in_base_price,billed_to_customer,notes")
    .eq("project_id", id)
    .limit(100);

  const expenseIds = Array.from(
    new Set(
      (projectExpenses ?? [])
        .map((row: any) =>
          typeof row?.expense_id === "string" ? row.expense_id : null
        )
        .filter(Boolean)
    )
  ) as string[];

  const { data: expenses, error: expensesError } =
    expenseIds.length > 0
      ? await supabase
          .from("expenses")
          .select(
            "id,expense_date,amount,category,description,business_domain,notes,recorded_by,created_at,updated_at"
          )
          .in("id", expenseIds)
      : { data: [], error: null as any };

  const expensesById = new Map<string, any>();
  (expenses ?? []).forEach((e: any) => {
    if (typeof e?.id === "string") expensesById.set(e.id, e);
  });

  const expenseList = (projectExpenses ?? [])
    .map((pe: any) => ({
      project_expense: pe,
      expense:
        typeof pe?.expense_id === "string"
          ? expensesById.get(pe.expense_id) ?? null
          : null,
    }))
    .sort((a, b) => {
      const ad = (a.expense?.expense_date ?? a.expense?.created_at) as
        | string
        | undefined;
      const bd = (b.expense?.expense_date ?? b.expense?.created_at) as
        | string
        | undefined;
      const at = ad ? new Date(ad).getTime() : 0;
      const bt = bd ? new Date(bd).getTime() : 0;
      return bt - at;
    });

  const { data: payments, error: paymentsError } = await supabase
    .from("payments")
    .select(
      "id,target_type,target_id,payment_date,amount_total,payment_method,reference_number,vat_amount,amount_before_vat,net_amount,recorded_by,notes,created_at,updated_at"
    )
    .eq("target_type", "project")
    .eq("target_id", id)
    .order("payment_date", { ascending: false })
    .limit(100);

  const status =
    typeof (overview as any)?.status === "string" ? (overview as any).status : "";

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              {typeof (overview as any)?.name === "string"
                ? (overview as any).name
                : "פרויקט"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {typeof (overview as any)?.customer_name === "string"
                ? (overview as any).customer_name
                : ""}
            </p>
          </div>
          <Link className="text-sm text-primary" href="/projects">
            חזרה לפרויקטים
          </Link>
        </div>

        {status ? (
          <div>
            <Badge variant={projectStatusVariant(status)}>
              {projectStatusLabel(status)}
            </Badge>
          </div>
        ) : null}

        {overviewError ? (
          <div className="text-destructive text-sm">
            שגיאה בטעינת פרויקט: {overviewError.message}
          </div>
        ) : (
          <ProjectTabsClient
            overview={overview as any}
            financials={(financials as any) ?? null}
            tasks={(tasks as any) ?? null}
            projectTasks={(projectTasks as any) ?? []}
            projectTasksError={projectTasksError?.message ?? null}
            assignableUsers={(assignableUsers as any) ?? []}
            assignableUsersError={assignableUsersError?.message ?? null}
            expenseSummary={(expenseSummary as any) ?? null}
            expenseSummaryError={expenseSummaryError?.message ?? null}
            expenses={expenseList as any}
            expensesError={
              projectExpensesError?.message ?? expensesError?.message ?? null
            }
            payments={(payments as any) ?? []}
            paymentsError={paymentsError?.message ?? null}
          />
        )}
      </div>
    </AppShell>
  );
}
