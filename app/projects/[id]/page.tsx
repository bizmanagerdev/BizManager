import Link from "next/link";
import dynamic from "next/dynamic";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import DeleteProjectButton from "@/app/projects/DeleteProjectButton";
import type {
  AssignableUser,
  ExpenseListItem,
  ProjectFinancials,
  ProjectOverview,
  ProjectTaskProgress,
} from "@/app/projects/[id]/ProjectTabsClient";
import { PAYMENT_SELECT } from "@/lib/payments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import { formatShortDate } from "@/lib/date";

const ProjectTabsClient = dynamic(() => import("@/app/projects/[id]/ProjectTabsClient"), {
  loading: () => (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="h-40 animate-pulse rounded-2xl border bg-muted/30"
        />
      ))}
    </div>
  ),
});

const DOCUMENTS_BUCKET = "business-documents";

type UnknownRow = Record<string, unknown>;

type ExpenseRow = {
  id: string;
  expense_date: string | null;
  amount: number | string | null;
  category: string | null;
  description: string | null;
  business_domain: string | null;
  notes: string | null;
  recorded_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type DocumentRow = {
  id: string;
  document_type: string | null;
  title: string | null;
  file_name: string | null;
  storage_key: string | null;
  uploaded_at: string | null;
  created_at: string | null;
};

function getFirstString(obj: UnknownRow | null | undefined, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

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

function projectTypeLabel(type: string | null | undefined) {
  switch (type) {
    case "logistics":
      return "לוגיסטיקה";
    case "construction":
      return "בנייה";
    case "moving":
      return "הובלה";
    case "home":
      return "בית";
    case "other":
      return "אחר";
    default:
      return type ?? "לא הוגדר";
  }
}

function formatDate(value: string | null | undefined) {
  return formatShortDate(value, "—");
}

function formatIls(value: number | string | null | undefined) {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/,/g, "").trim())
        : null;

  if (amount === null || !Number.isFinite(amount)) return "—";

  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(amount);
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
    .select(
      "id,name,status,project_type,start_date,end_date,agreed_base_price,actual_price,expenses_billed_separately,customer_id,customer_name,project_manager_id,project_manager_name,created_at,updated_at"
    )
    .eq("id", id)
    .maybeSingle<ProjectOverview>();

  const { data: financials } = await supabase
    .from("project_financials_view")
    .select("id,agreed_base_price,actual_price,total_expenses,gross_profit")
    .eq("id", id)
    .maybeSingle<ProjectFinancials extends infer T ? Exclude<T, null> : never>();

  const { data: tasks } = await supabase
    .from("project_task_progress_view")
    .select("project_id,total_tasks,completed_tasks,open_tasks")
    .eq("project_id", id)
    .maybeSingle<ProjectTaskProgress extends infer T ? Exclude<T, null> : never>();

  const { data: projectTasks, error: projectTasksError } = await supabase
    .from("task_overview_view")
    .select(
      "task_id,subject,status,priority,due_date,project_id,project_name,assigned_user_id,assigned_user_name,created_at,updated_at,is_overdue"
    )
    .eq("project_id", id)
    .order("due_date", { ascending: true })
    .range(0, 199);

  const { data: assignableUsers, error: assignableUsersError } = await supabase
    .from("users")
    .select("id,full_name,email,role,active")
    .order("full_name", { ascending: true })
    .range(0, 199);

  const { data: projectExpenses, error: projectExpensesError } = await supabase
    .from("project_expenses")
    .select("id,project_id,expense_id,included_in_base_price,billed_to_customer,notes")
    .eq("project_id", id)
    .order("id", { ascending: false })
    .range(0, 99);

  const expenseIds = Array.from(
    new Set(
      (projectExpenses ?? [])
        .map((row) => (typeof row.expense_id === "string" ? row.expense_id : null))
        .filter((value): value is string => Boolean(value))
    )
  );

  const { data: expenses, error: expensesError } =
    expenseIds.length > 0
      ? await supabase
          .from("expenses")
          .select(
            "id,expense_date,amount,category,description,business_domain,notes,recorded_by,created_at,updated_at"
          )
          .order("expense_date", { ascending: false })
          .in("id", expenseIds)
      : { data: [] as ExpenseRow[], error: null };

  const expensesById = new Map<string, ExpenseRow>();
  (expenses ?? []).forEach((e) => {
    if (typeof e.id === "string") expensesById.set(e.id, e);
  });

  const expenseList = (projectExpenses ?? [])
    .map((pe): ExpenseListItem => ({
      project_expense: pe,
      expense: typeof pe.expense_id === "string" ? expensesById.get(pe.expense_id) ?? null : null,
    }))
    .sort((a, b) => {
      const ad = (a.expense?.expense_date ?? a.expense?.created_at) as string | undefined;
      const bd = (b.expense?.expense_date ?? b.expense?.created_at) as string | undefined;
      const at = ad ? new Date(ad).getTime() : 0;
      const bt = bd ? new Date(bd).getTime() : 0;
      return bt - at;
    });

  const { data: payments, error: paymentsQueryError } = await supabase
    .from("payments")
    .select(PAYMENT_SELECT)
    .eq("project_id", id)
    .order("payment_date", { ascending: false })
    .range(0, 99);

  const paymentsError = paymentsQueryError?.message ?? null;

  const { data: projectDocumentLinks, error: projectDocumentsError } = await supabase
    .from("document_links")
    .select("document_id,entity_type,entity_id,created_at")
    .eq("entity_type", "project")
    .eq("entity_id", id)
    .order("created_at", { ascending: false })
    .range(0, 199);

  const projectDocumentIds = Array.from(
    new Set(
      (projectDocumentLinks ?? [])
        .map((row) => (typeof row.document_id === "string" ? row.document_id : null))
        .filter((value): value is string => Boolean(value))
    )
  );

  const { data: projectDocumentsRaw, error: projectDocumentsReadError } =
    projectDocumentIds.length > 0
      ? await supabase
          .from("documents")
          .select("id,document_type,title,file_name,storage_key,uploaded_at,created_at")
          .in("id", projectDocumentIds)
      : { data: [] as DocumentRow[], error: null };

  const projectDocumentsErrorMessage =
    projectDocumentsError?.message ?? projectDocumentsReadError?.message ?? null;

  const projectDocumentsById = new Map<string, DocumentRow>();
  (projectDocumentsRaw ?? []).forEach((row) => {
    if (typeof row.id === "string") projectDocumentsById.set(row.id, row);
  });

  const projectDocumentsUnique = await Promise.all(
    (projectDocumentLinks ?? [])
      .map(async (link) => {
        const documentId = typeof link.document_id === "string" ? link.document_id : null;
        if (!documentId) return null;

        const row = projectDocumentsById.get(documentId) ?? null;
        if (!row) return null;

        const storageKey = getFirstString(row, ["storage_key"]);
        const fileName = getFirstString(row, ["file_name"]);
        const title = getFirstString(row, ["title"]);
        const documentType = getFirstString(row, ["document_type"]);
        const entityType = getFirstString(link, ["entity_type"]);
        const entityId = getFirstString(link, ["entity_id"]);
        const uploadedAt =
          getFirstString(row, ["uploaded_at"]) ?? getFirstString(link, ["created_at"]);

        const { data: signed, error: signError } = storageKey
          ? await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(storageKey, 60 * 60)
          : { data: null, error: null };

        const url =
          signError ? null : typeof signed?.signedUrl === "string" ? signed.signedUrl : null;

        return {
          document_id: documentId,
          storage_key: storageKey,
          file_name: fileName,
          title,
          document_type: documentType,
          entity_type: entityType,
          entity_id: entityId,
          uploaded_at: uploadedAt,
          url,
        };
      })
  );

  const normalizedProjectDocuments = projectDocumentsUnique.filter(
    (
      document
    ): document is {
      document_id: string;
      storage_key: string | null;
      file_name: string | null;
      title: string | null;
      document_type: string | null;
      entity_type: string | null;
      entity_id: string | null;
      uploaded_at: string | null;
      url: string | null;
    } => Boolean(document)
  );

  const status = typeof overview?.status === "string" ? overview.status : "";
  const projectName = typeof overview?.name === "string" ? overview.name : "פרויקט";
  const customerName =
    typeof overview?.customer_name === "string" ? overview.customer_name : "";
  const managerName =
    typeof overview?.project_manager_name === "string" ? overview.project_manager_name : null;
  const startDate = typeof overview?.start_date === "string" ? overview.start_date : null;
  const endDate = typeof overview?.end_date === "string" ? overview.end_date : null;
  const projectType =
    typeof overview?.project_type === "string" ? overview.project_type : null;
  const grossProfit =
    typeof financials?.gross_profit === "number" || typeof financials?.gross_profit === "string"
      ? financials.gross_profit
      : null;
  const openTasks =
    typeof tasks?.open_tasks === "number" || typeof tasks?.open_tasks === "string" ? tasks.open_tasks : 0;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-5">
        <Card className="overflow-hidden">
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href="/projects">
                        <ChevronRight className="h-4 w-4" />
                        <span>חזרה לפרויקטים</span>
                      </Link>
                    </Button>
                    {status ? (
                      <Badge variant={projectStatusVariant(status)}>{projectStatusLabel(status)}</Badge>
                    ) : null}
                    <Badge variant="outline">{projectTypeLabel(projectType)}</Badge>
                  </div>

                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                      {projectName}
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {customerName || "ללא לקוח משויך"}
                    </p>
                  </div>
                </div>

                {typeof overview?.id === "string" ? (
                  <DeleteProjectButton
                    projectId={overview.id}
                    projectName={projectName}
                    redirectTo="/projects"
                  />
                ) : null}
              </div>

              <div className="flex flex-wrap items-start gap-x-8 gap-y-4 rounded-2xl border border-border/70 bg-background/70 p-4 text-sm">
                <div className="min-w-[10rem] space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">לקוח:</div>
                  <div className="font-medium">{customerName || "—"}</div>
                </div>
                <div className="min-w-[8rem] space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">סטטוס:</div>
                  <div className="font-medium">{status ? projectStatusLabel(status) : "—"}</div>
                </div>
                <div className="min-w-[8rem] space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">רווח:</div>
                  <div className="font-medium">{formatIls(grossProfit)}</div>
                </div>
                <div className="min-w-[8rem] space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">משימות פתוחות:</div>
                  <div className="font-medium">{openTasks}</div>
                </div>
                <div className="min-w-[8rem] space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">התחלה:</div>
                  <div className="font-medium">{formatDate(startDate)}</div>
                </div>
                <div className="min-w-[8rem] space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">סיום:</div>
                  <div className="font-medium">{formatDate(endDate)}</div>
                </div>
                <div className="min-w-[10rem] space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">מנהל פרויקט:</div>
                  <div className="font-medium">{managerName || "לא הוגדר"}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {overviewError ? (
          <div className="text-destructive text-sm">
            שגיאה בטעינת פרויקט: {overviewError.message}
          </div>
        ) : !overview ? (
          <div className="text-sm text-muted-foreground">הפרויקט לא נמצא.</div>
        ) : (
          <ProjectTabsClient
            overview={overview}
            financials={financials ?? null}
            tasks={tasks ?? null}
            projectTasks={projectTasks ?? []}
            projectTasksError={projectTasksError?.message ?? null}
            projectDocuments={normalizedProjectDocuments}
            projectDocumentsError={projectDocumentsErrorMessage}
            assignableUsers={(assignableUsers as AssignableUser[] | null) ?? []}
            assignableUsersError={assignableUsersError?.message ?? null}
            expenses={expenseList}
            expensesError={projectExpensesError?.message ?? expensesError?.message ?? null}
            payments={payments ?? []}
            paymentsError={paymentsError}
          />
        )}
      </div>
    </AppShell>
  );
}

