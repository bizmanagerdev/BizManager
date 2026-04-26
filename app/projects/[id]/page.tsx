import Link from "next/link";
import dynamic from "next/dynamic";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import ProjectDetailsActions from "@/app/projects/[id]/ProjectDetailsActions";
import type {
  AssignableUser,
  ExpenseListItem,
  ProjectFinancials,
  ProjectOverview,
  ProjectTaskProgress,
} from "@/app/projects/[id]/ProjectTabsClient";
import { PAYMENT_SELECT } from "@/lib/payments";
import type { FinancialAttachment } from "@/lib/payments";
import type { WorkSessionRow } from "@/lib/payroll";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ChevronRight } from "lucide-react";
import { formatShortDate } from "@/lib/date";
import { getProjectStatusLabel } from "@/lib/ui/status-colors";

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
  attachments?: FinancialAttachment[];
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

type AttendanceSessionRow = WorkSessionRow;

function getFirstString(obj: UnknownRow | null | undefined, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

function projectStatusLabel(status: string) {
  return getProjectStatusLabel(status);
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

  const { data: overviewRaw, error: overviewError } = await supabase
    .from("project_overview_view")
    .select(
      "id,name,status,project_type,start_date,end_date,agreed_base_price,actual_price,expenses_billed_separately,customer_id,customer_name,project_manager_id,project_manager_name,created_at,updated_at"
    )
    .eq("id", id)
    .maybeSingle<Omit<ProjectOverview, "notes">>();

  const overview: ProjectOverview | null = overviewRaw
    ? {
        ...overviewRaw,
        notes: null,
      }
    : null;

  const { data: financials } = await supabase
    .from("project_financials_view")
    .select("id,agreed_base_price,actual_price,total_expenses,expenses_billed,customer_total_price,gross_profit")
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

  const { data: customers } = await supabase
    .from("customer_overview_view")
    .select("customer_id,customer_name")
    .order("customer_name", { ascending: true })
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

  const { data: expenseLinks } =
    expenseIds.length > 0
      ? await supabase
          .from("document_links")
          .select("document_id,entity_type,entity_id,created_at")
          .eq("entity_type", "expense")
          .in("entity_id", expenseIds)
      : { data: [] as UnknownRow[] };

  const expenseDocumentIds = Array.from(
    new Set(
      (expenseLinks ?? [])
        .map((row) => (typeof row.document_id === "string" ? row.document_id : null))
        .filter((value): value is string => Boolean(value))
    )
  );

  const { data: expenseDocuments } =
    expenseDocumentIds.length > 0
      ? await supabase
          .from("documents")
          .select("id,title,file_name,storage_key,uploaded_at,document_type")
          .in("id", expenseDocumentIds)
      : { data: [] as UnknownRow[] };

  const expenseDocumentById = new Map<string, UnknownRow>();
  (expenseDocuments ?? []).forEach((row) => {
    if (typeof row.id === "string") expenseDocumentById.set(row.id, row);
  });

  const expenseAttachmentByEntityId = new Map<string, FinancialAttachment[]>();
  for (const link of expenseLinks ?? []) {
    const entityId = typeof link.entity_id === "string" ? link.entity_id : null;
    const documentId = typeof link.document_id === "string" ? link.document_id : null;
    if (!entityId || !documentId) continue;
    const doc = expenseDocumentById.get(documentId);
    const storageKey = getFirstString(doc, ["storage_key"]);
    const fileName = getFirstString(doc, ["file_name"]);
    const documentType = getFirstString(doc, ["document_type"]);
    const uploadedAt = getFirstString(doc, ["uploaded_at"]) ?? getFirstString(link, ["created_at"]);
    const { data: signed } = storageKey
      ? await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(storageKey, 60 * 60)
      : { data: null };
    const existing = expenseAttachmentByEntityId.get(entityId) ?? [];
    existing.push({
      document_id: documentId,
      file_name: fileName,
      storage_key: storageKey,
      uploaded_at: uploadedAt,
      document_type: documentType,
      url: typeof signed?.signedUrl === "string" ? signed.signedUrl : null,
    });
    expenseAttachmentByEntityId.set(entityId, existing);
  }

  expenseAttachmentByEntityId.forEach((attachment, entityId) => {
    const expense = expensesById.get(entityId);
    if (!expense) return;
    expense.attachments = attachment;
  });

  const expenseList = (projectExpenses ?? [])
    .map((pe): ExpenseListItem => ({
      source_type: "expense",
      project_expense: pe,
      expense: typeof pe.expense_id === "string" ? expensesById.get(pe.expense_id) ?? null : null,
      session: null,
    }));

  const { data: attendanceSessions, error: attendanceSessionsError } = await supabase
    .from("attendance_sessions")
    .select("id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id")
    .eq("project_id", id)
    .order("clock_in", { ascending: false })
    .range(0, 99);

  const combinedExpenseList = [
    ...expenseList,
    ...((attendanceSessions ?? []) as AttendanceSessionRow[]).map(
      (session): ExpenseListItem => ({
        source_type: "session",
        project_expense: null,
        expense: null,
        session,
      })
    ),
  ].sort((a, b) => {
    const ad =
      a.source_type === "session"
        ? a.session?.clock_in
        : ((a.expense?.expense_date ?? a.expense?.created_at) as string | undefined);
    const bd =
      b.source_type === "session"
        ? b.session?.clock_in
        : ((b.expense?.expense_date ?? b.expense?.created_at) as string | undefined);
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

  const paymentIds = Array.from(
    new Set(
      (payments ?? [])
        .map((row) => (typeof row.id === "string" ? row.id : null))
        .filter((value): value is string => Boolean(value))
    )
  );

  const { data: paymentLinks } =
    paymentIds.length > 0
      ? await supabase
          .from("document_links")
          .select("document_id,entity_type,entity_id,created_at")
          .eq("entity_type", "payment")
          .in("entity_id", paymentIds)
      : { data: [] as UnknownRow[] };

  const paymentDocumentIds = Array.from(
    new Set(
      (paymentLinks ?? [])
        .map((row) => (typeof row.document_id === "string" ? row.document_id : null))
        .filter((value): value is string => Boolean(value))
    )
  );

  const { data: paymentDocuments } =
    paymentDocumentIds.length > 0
      ? await supabase
          .from("documents")
          .select("id,title,file_name,storage_key,uploaded_at,document_type")
          .in("id", paymentDocumentIds)
      : { data: [] as UnknownRow[] };

  const paymentDocumentById = new Map<string, UnknownRow>();
  (paymentDocuments ?? []).forEach((row) => {
    if (typeof row.id === "string") paymentDocumentById.set(row.id, row);
  });

  const paymentAttachmentByEntityId = new Map<string, FinancialAttachment[]>();
  for (const link of paymentLinks ?? []) {
    const entityId = typeof link.entity_id === "string" ? link.entity_id : null;
    const documentId = typeof link.document_id === "string" ? link.document_id : null;
    if (!entityId || !documentId) continue;
    const doc = paymentDocumentById.get(documentId);
    const storageKey = getFirstString(doc, ["storage_key"]);
    const fileName = getFirstString(doc, ["file_name"]);
    const documentType = getFirstString(doc, ["document_type"]);
    const uploadedAt = getFirstString(doc, ["uploaded_at"]) ?? getFirstString(link, ["created_at"]);
    const { data: signed } = storageKey
      ? await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(storageKey, 60 * 60)
      : { data: null };
    const existing = paymentAttachmentByEntityId.get(entityId) ?? [];
    existing.push({
      document_id: documentId,
      file_name: fileName,
      storage_key: storageKey,
      uploaded_at: uploadedAt,
      document_type: documentType,
      url: typeof signed?.signedUrl === "string" ? signed.signedUrl : null,
    });
    paymentAttachmentByEntityId.set(entityId, existing);
  }

  const paymentsWithPhotos = (payments ?? []).map((payment) => {
    const attachments = paymentAttachmentByEntityId.get(payment.id);
    return attachments
      ? {
          ...payment,
          attachments,
        }
      : payment;
  });

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
          .select("id,document_type,title,file_name,storage_key,uploaded_at")
          .in("id", projectDocumentIds)
      : { data: [] as DocumentRow[], error: null };

  const projectDocumentsErrorMessage =
    projectDocumentsError?.message ?? projectDocumentsReadError?.message ?? null;

  const projectDocumentsById = new Map<string, UnknownRow>();
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
  const grossProfit = financials?.gross_profit ?? null;
  const openTasks =
    typeof tasks?.open_tasks === "number" || typeof tasks?.open_tasks === "string" ? tasks.open_tasks : 0;
  const customerOptions = ((customers ?? []) as UnknownRow[])
    .map((row) => ({
      id: typeof row.customer_id === "string" ? row.customer_id : "",
      label: typeof row.customer_name === "string" ? row.customer_name.trim() : "",
    }))
    .filter((row) => row.id && row.label);
  const managerOptions = ((assignableUsers ?? []) as UnknownRow[])
    .map((row) => {
      const fullName = typeof row.full_name === "string" ? row.full_name.trim() : "";
      const email = typeof row.email === "string" ? row.email.trim() : "";
      return {
        id: typeof row.id === "string" ? row.id : "",
        label: fullName || email,
        active: row.active,
      };
    })
    .filter((row) => row.id && row.label && row.active !== false)
    .map((row) => ({ id: row.id, label: row.label }));

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
                      <StatusBadge value={status} type="project" />
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

                {overview ? (
                  <ProjectDetailsActions
                    project={overview}
                    customerOptions={customerOptions}
                    managerOptions={managerOptions}
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
            expenses={combinedExpenseList}
            expensesError={
              projectExpensesError?.message ?? expensesError?.message ?? attendanceSessionsError?.message ?? null
            }
            payments={paymentsWithPhotos}
            paymentsError={paymentsError}
          />
        )}
      </div>
    </AppShell>
  );
}

