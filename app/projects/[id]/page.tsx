import Link from "next/link";
import dynamic from "next/dynamic";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import ProjectDetailsActions from "@/app/projects/[id]/ProjectDetailsActions";
import { getLatestAuditByRecordIds, resolveUserDisplayNamesForValues } from "@/lib/audit";
import type {
  AssignableUser,
  ExpenseListItem,
  ProjectFinancials,
  ProjectOverview,
  ProjectSalaryAgreement,
  ProjectTaskProgress,
  ProjectWorkerBalance,
} from "@/app/projects/[id]/ProjectTabsClient";
import { PAYMENT_SELECT } from "@/lib/payments";
import type { FinancialAttachment } from "@/lib/payments";
import type { MorningLocalDocument } from "@/lib/morning/types";
import type { WorkSessionRow } from "@/lib/payroll";
import { paymentStatusClasses, paymentStatusLabel } from "@/lib/orders/paymentStatus";
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
  payment_method: string | null;
  payment_status: string | null;
  paid_amount: number | string | null;
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
  uploaded_by?: string | null;
};

type AttendanceSessionRow = WorkSessionRow;

function getFirstString(obj: UnknownRow | null | undefined, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

function isMissingColumnError(error: unknown, columnName: string) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  const message = "message" in error ? (error as { message?: unknown }).message : undefined;
  return (
    code === "42703" &&
    typeof message === "string" &&
    message.toLowerCase().includes(columnName.toLowerCase())
  );
}

function projectStatusLabel(status: string) {
  return getProjectStatusLabel(status);
}

function projectTypeLabel(type: string | null | undefined) {
  switch (type) {
    case "logistics":
      return "לוגיסטיקה";
    case "construction":
      return "שיפוצים";
    case "moving":
      return "הובלה";
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

function userDisplayName(row: UnknownRow | null | undefined) {
  const fullName = getFirstString(row, ["full_name"]);
  if (fullName && fullName.trim()) return fullName.trim();
  const email = getFirstString(row, ["email"]);
  if (email && email.trim()) return email.trim();
  return "משתמש";
}

type CustomerPaymentStatus = "paid" | "partial" | "unpaid" | "unpriced";

function deriveCustomerPaymentStatus(totalDue: number | null, paidTotal: number) {
  if (totalDue === null || totalDue <= 0) return "unpriced" as const;
  if (paidTotal + 0.009 >= totalDue) return "paid" as const;
  if (paidTotal > 0) return "partial" as const;
  return "unpaid" as const;
}

function customerPaymentStatusLabel(status: CustomerPaymentStatus) {
  if (status === "unpriced") return "לא סוכם תשלום";
  return paymentStatusLabel(status);
}

function customerPaymentStatusClasses(status: CustomerPaymentStatus) {
  if (status === "unpriced") return "border-border bg-background text-muted-foreground";
  return paymentStatusClasses(status);
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const rawView = Array.isArray(resolvedSearchParams?.view)
    ? resolvedSearchParams?.view[0]
    : resolvedSearchParams?.view;
  const returnView = rawView === "quotes" || rawView === "closed" ? rawView : "projects";
  const backHref = returnView === "projects" ? "/projects" : `/projects?view=${returnView}`;
  const { profile, supabase } = await requireProfile();

  const { data: overviewRaw, error: overviewError } = await supabase
    .from("project_overview_view")
    .select(
      "id,name,status,project_type,start_date,end_date,agreed_base_price,actual_price,expenses_billed_separately,customer_id,customer_name,project_manager_id,project_manager_name,created_at,updated_at"
    )
    .eq("id", id)
    .maybeSingle<Omit<ProjectOverview, "notes" | "items_to_move">>();

  const { data: projectDetailsRaw } = await supabase
    .from("projects")
    .select("id,notes,items_to_move")
    .eq("id", id)
    .maybeSingle<{ id: string; notes: string | null; items_to_move: string[] | null }>();

  const overview: ProjectOverview | null = overviewRaw
    ? {
        ...overviewRaw,
        notes: typeof projectDetailsRaw?.notes === "string" ? projectDetailsRaw.notes : null,
        items_to_move: Array.isArray(projectDetailsRaw?.items_to_move)
          ? projectDetailsRaw.items_to_move.filter((item): item is string => typeof item === "string")
          : null,
      }
    : null;

  const { data: financials } = await supabase
    .from("project_financials_view")
    .select("id,agreed_base_price,actual_price,total_expenses,expenses_billed,customer_total_price,gross_profit")
    .eq("id", id)
    .maybeSingle<ProjectFinancials extends infer T ? Exclude<T, null> : never>();

  const { data: workerBalance } = await supabase
    .from("project_worker_balance_view")
    .select("project_id,earned_amount,paid_amount,owed_amount")
    .eq("project_id", id)
    .maybeSingle<ProjectWorkerBalance extends infer T ? Exclude<T, null> : never>();

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

  const assignableUserIds = Array.from(
    new Set(
      (assignableUsers ?? [])
        .map((user) => (typeof user.id === "string" ? user.id : null))
        .filter((value): value is string => Boolean(value))
    )
  );

  const { data: salaryAgreements } =
    assignableUserIds.length > 0
      ? await supabase
          .from("salary_agreements")
          .select(
            "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours"
          )
          .in("user_id", assignableUserIds)
          .order("valid_from", { ascending: false })
      : { data: [] as ProjectSalaryAgreement[] };

  const { data: customers } = await supabase
    .from("customer_overview_view")
    .select("customer_id,customer_name,phone")
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

  let expenses: ExpenseRow[] = [];
  let expensesError: { message: string } | null = null;

  if (expenseIds.length > 0) {
    const primaryResult = await supabase
      .from("expenses")
      .select(
        "id,expense_date,amount,payment_method,payment_status,paid_amount,category,description,business_domain,notes,recorded_by,created_at,updated_at"
      )
      .order("expense_date", { ascending: false })
      .in("id", expenseIds);

    if (primaryResult.error && isMissingColumnError(primaryResult.error, "payment_method")) {
      const fallbackResult = await supabase
        .from("expenses")
        .select("id,expense_date,amount,payment_status,paid_amount,category,description,business_domain,notes,recorded_by,created_at,updated_at")
        .order("expense_date", { ascending: false })
        .in("id", expenseIds);

      expensesError = fallbackResult.error ? { message: fallbackResult.error.message } : null;
      expenses = ((fallbackResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        payment_method: null,
      })) as ExpenseRow[];
    } else {
      expensesError = primaryResult.error ? { message: primaryResult.error.message } : null;
      expenses = (primaryResult.data ?? []) as ExpenseRow[];
    }
  }

  const expenseAuditResult = await getLatestAuditByRecordIds(supabase, {
    tableName: "expenses",
    recordIds: expenseIds,
  });

  const expenseRecordedByValues = Array.from(
    new Set(
      (expenses ?? [])
        .map((row) => (typeof row.recorded_by === "string" ? row.recorded_by : null))
        .filter((value): value is string => Boolean(value))
    )
  );

  const [expenseRecordedByIdUsersResult, expenseRecordedByAuthUsersResult] = await Promise.all([
    expenseRecordedByValues.length > 0
      ? supabase
          .from("users")
          .select("id,auth_user_id,full_name,email")
          .in("id", expenseRecordedByValues)
      : Promise.resolve({ data: [] as UnknownRow[], error: null }),
    expenseRecordedByValues.length > 0
      ? supabase
          .from("users")
          .select("id,auth_user_id,full_name,email")
          .in("auth_user_id", expenseRecordedByValues)
      : Promise.resolve({ data: [] as UnknownRow[], error: null }),
  ]);

  const expenseRecordedByNameByValue: Record<string, string> = {};
  for (const row of [
    ...((expenseRecordedByIdUsersResult.data ?? []) as UnknownRow[]),
    ...((expenseRecordedByAuthUsersResult.data ?? []) as UnknownRow[]),
  ]) {
    const displayName = userDisplayName(row);
    const userId = getFirstString(row, ["id"]);
    const authUserId = getFirstString(row, ["auth_user_id"]);
    if (userId) expenseRecordedByNameByValue[userId] = displayName;
    if (authUserId) expenseRecordedByNameByValue[authUserId] = displayName;
  }

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

  const attendanceSessionIds = Array.from(
    new Set(
      (attendanceSessions ?? [])
        .map((session) => (typeof session.id === "string" ? session.id : null))
        .filter((value): value is string => Boolean(value))
    )
  );

  const { data: sessionDebtItems } =
    attendanceSessionIds.length > 0
      ? await supabase
          .from("worker_debt_items_view")
          .select("source_id,paid_amount,owed_amount,payment_status,last_payment_date")
          .eq("source_type", "session")
          .in("source_id", attendanceSessionIds)
      : { data: [] as Array<Record<string, unknown>> };

  const sessionDebtById = new Map<string, Record<string, unknown>>();
  (sessionDebtItems ?? []).forEach((row) => {
    if (typeof row.source_id === "string") sessionDebtById.set(row.source_id, row);
  });

  const { data: sessionLinks } =
    attendanceSessionIds.length > 0
      ? await supabase
          .from("document_links")
          .select("document_id,entity_type,entity_id,created_at")
          .eq("entity_type", "session")
          .in("entity_id", attendanceSessionIds)
      : { data: [] as UnknownRow[] };

  const sessionDocumentIds = Array.from(
    new Set(
      (sessionLinks ?? [])
        .map((row) => (typeof row.document_id === "string" ? row.document_id : null))
        .filter((value): value is string => Boolean(value))
    )
  );

  const { data: sessionDocuments } =
    sessionDocumentIds.length > 0
      ? await supabase
          .from("documents")
          .select("id,title,file_name,storage_key,uploaded_at,document_type")
          .in("id", sessionDocumentIds)
      : { data: [] as UnknownRow[] };

  const sessionDocumentById = new Map<string, UnknownRow>();
  (sessionDocuments ?? []).forEach((row) => {
    if (typeof row.id === "string") sessionDocumentById.set(row.id, row);
  });

  const sessionAttachmentByEntityId = new Map<string, FinancialAttachment[]>();
  for (const link of sessionLinks ?? []) {
    const entityId = typeof link.entity_id === "string" ? link.entity_id : null;
    const documentId = typeof link.document_id === "string" ? link.document_id : null;
    if (!entityId || !documentId) continue;
    const doc = sessionDocumentById.get(documentId);
    const storageKey = getFirstString(doc, ["storage_key"]);
    const fileName = getFirstString(doc, ["file_name"]);
    const documentType = getFirstString(doc, ["document_type"]);
    const uploadedAt = getFirstString(doc, ["uploaded_at"]) ?? getFirstString(link, ["created_at"]);
    const { data: signed } = storageKey
      ? await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(storageKey, 60 * 60)
      : { data: null };
    const existing = sessionAttachmentByEntityId.get(entityId) ?? [];
    existing.push({
      document_id: documentId,
      file_name: fileName,
      storage_key: storageKey,
      uploaded_at: uploadedAt,
      document_type: documentType,
      url: typeof signed?.signedUrl === "string" ? signed.signedUrl : null,
    });
    sessionAttachmentByEntityId.set(entityId, existing);
  }

  const combinedExpenseList = [
    ...expenseList,
    ...((attendanceSessions ?? []) as AttendanceSessionRow[]).map(
      (session): ExpenseListItem => {
        const debtItem = sessionDebtById.get(session.id) ?? null;
        const paidAmount = debtItem?.paid_amount;
        const owedAmount = debtItem?.owed_amount;
        return {
          source_type: "session",
          project_expense: null,
          expense: null,
          session: {
            ...session,
            paid_amount:
              typeof paidAmount === "number" || typeof paidAmount === "string" ? paidAmount : null,
            owed_amount:
              typeof owedAmount === "number" || typeof owedAmount === "string" ? owedAmount : null,
            payment_status: typeof debtItem?.payment_status === "string" ? debtItem.payment_status : null,
            last_payment_date:
              typeof debtItem?.last_payment_date === "string" ? debtItem.last_payment_date : null,
            attachments: sessionAttachmentByEntityId.get(session.id) ?? [],
          },
        };
      }
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

  const paymentAuditResult = await getLatestAuditByRecordIds(supabase, {
    tableName: "payments",
    recordIds: paymentIds,
  });

  const paymentRecordedByValues = Array.from(
    new Set(
      (payments ?? [])
        .map((row) => (typeof row.recorded_by === "string" ? row.recorded_by : null))
        .filter((value): value is string => Boolean(value))
    )
  );

  const [paymentRecordedByIdUsersResult, paymentRecordedByAuthUsersResult] = await Promise.all([
    paymentRecordedByValues.length > 0
      ? supabase
          .from("users")
          .select("id,auth_user_id,full_name,email")
          .in("id", paymentRecordedByValues)
      : Promise.resolve({ data: [] as UnknownRow[], error: null }),
    paymentRecordedByValues.length > 0
      ? supabase
          .from("users")
          .select("id,auth_user_id,full_name,email")
          .in("auth_user_id", paymentRecordedByValues)
      : Promise.resolve({ data: [] as UnknownRow[], error: null }),
  ]);

  const paymentRecordedByNameByValue: Record<string, string> = {};
  for (const row of [
    ...((paymentRecordedByIdUsersResult.data ?? []) as UnknownRow[]),
    ...((paymentRecordedByAuthUsersResult.data ?? []) as UnknownRow[]),
  ]) {
    const displayName = userDisplayName(row);
    const userId = getFirstString(row, ["id"]);
    const authUserId = getFirstString(row, ["auth_user_id"]);
    if (userId) paymentRecordedByNameByValue[userId] = displayName;
    if (authUserId) paymentRecordedByNameByValue[authUserId] = displayName;
  }

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

  const [
    { data: projectMorningDocuments, error: projectMorningDocumentsError },
    { data: paymentMorningDocuments, error: paymentMorningDocumentsError },
  ] = await Promise.all([
    supabase
      .from("morning_documents")
      .select(
        "id,morning_document_id,morning_document_number,document_type,document_type_label,status,customer_id,order_id,project_id,payment_id,document_id,morning_client_id,amount,currency,morning_url,pdf_url,issued_at,closed_at,notes"
      )
      .eq("project_id", id)
      .order("issued_at", { ascending: false }),
    paymentIds.length > 0
      ? supabase
          .from("morning_documents")
          .select(
            "id,morning_document_id,morning_document_number,document_type,document_type_label,status,customer_id,order_id,project_id,payment_id,document_id,morning_client_id,amount,currency,morning_url,pdf_url,issued_at,closed_at,notes"
          )
          .in("payment_id", paymentIds)
          .order("issued_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const morningDocuments = Array.from(
    new Map(
      [
        ...((projectMorningDocuments ?? []) as Record<string, unknown>[]),
        ...((paymentMorningDocuments ?? []) as Record<string, unknown>[]),
      ].map((row) => [getFirstString(row, ["id"]) ?? crypto.randomUUID(), row])
    ).values()
  ) as MorningLocalDocument[];

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
          .select("id,document_type,title,file_name,storage_key,uploaded_at,uploaded_by")
          .in("id", projectDocumentIds)
      : { data: [] as DocumentRow[], error: null };

  const projectDocumentsErrorMessage =
    projectDocumentsError?.message ?? projectDocumentsReadError?.message ?? null;

  const projectDocumentsById = new Map<string, UnknownRow>();
  (projectDocumentsRaw ?? []).forEach((row) => {
    if (typeof row.id === "string") projectDocumentsById.set(row.id, row);
  });

  const projectDocumentUploadedByValues = Array.from(
    new Set(
      ((projectDocumentsRaw ?? []) as DocumentRow[])
        .map((row) => (typeof row.uploaded_by === "string" ? row.uploaded_by : null))
        .filter((value): value is string => Boolean(value))
    )
  );
  const projectDocumentUploaderNames = await resolveUserDisplayNamesForValues(
    supabase,
    projectDocumentUploadedByValues
  );

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
        const uploadedBy = getFirstString(row, ["uploaded_by"]);
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
          uploaded_by_name: uploadedBy ? projectDocumentUploaderNames[uploadedBy] ?? null : null,
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
      uploaded_by_name: string | null;
      url: string | null;
    } => Boolean(document)
  );


  const status = typeof overview?.status === "string" ? overview.status : "";
  const projectName = typeof overview?.name === "string" ? overview.name : "פרויקט";
  const customerName =
    typeof overview?.customer_name === "string" ? overview.customer_name : "";
  const customerPhoneRow =
    ((customers ?? []) as UnknownRow[]).find(
      (row) =>
        typeof row.customer_id === "string" &&
        row.customer_id === overview?.customer_id &&
        typeof row.phone === "string" &&
        row.phone.trim()
    ) ?? null;
  const customerPhone = typeof customerPhoneRow?.phone === "string" ? customerPhoneRow.phone : null;
  const projectNotes =
    typeof overview?.notes === "string" && overview.notes.trim() ? overview.notes.trim() : null;
  const managerName =
    typeof overview?.project_manager_name === "string" ? overview.project_manager_name : null;
  const startDate = typeof overview?.start_date === "string" ? overview.start_date : null;
  const endDate = typeof overview?.end_date === "string" ? overview.end_date : null;
  const projectType =
    typeof overview?.project_type === "string" ? overview.project_type : null;
  const itemsToMove = Array.isArray(overview?.items_to_move) ? overview.items_to_move : [];
  const grossProfit = financials?.gross_profit ?? null;
  const openTasks =
    typeof tasks?.open_tasks === "number" || typeof tasks?.open_tasks === "string" ? tasks.open_tasks : 0;
  const paidTotal = paymentsWithPhotos.reduce((sum, payment) => {
    const amount =
      typeof payment.amount_total === "number"
        ? payment.amount_total
        : typeof payment.amount_total === "string"
          ? Number(payment.amount_total)
          : NaN;
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  const agreedBasePrice =
    typeof overview?.agreed_base_price === "number"
      ? overview.agreed_base_price
      : typeof overview?.agreed_base_price === "string"
        ? Number(overview.agreed_base_price)
        : null;
  const actualPrice =
    typeof overview?.actual_price === "number"
      ? overview.actual_price
      : typeof overview?.actual_price === "string"
        ? Number(overview.actual_price)
        : null;
  const expensesBilled =
    typeof financials?.expenses_billed === "number"
      ? financials.expenses_billed
      : typeof financials?.expenses_billed === "string"
        ? Number(financials.expenses_billed)
        : 0;
  const baseProjectPrice =
    agreedBasePrice !== null && Number.isFinite(agreedBasePrice)
      ? agreedBasePrice
      : actualPrice !== null && Number.isFinite(actualPrice)
        ? actualPrice
        : null;
  const totalCustomerCharge =
    baseProjectPrice !== null ? baseProjectPrice + (Number.isFinite(expensesBilled) ? expensesBilled : 0) : null;
  const customerPaymentStatus = deriveCustomerPaymentStatus(totalCustomerCharge, paidTotal);
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
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-5">
        <Card className="overflow-hidden">
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={backHref}>
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
                    projectDocuments={normalizedProjectDocuments}
                    projectDocumentsError={projectDocumentsErrorMessage}
                  />
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border/70 bg-background/70 p-3 text-sm sm:grid-cols-2 sm:p-4 lg:flex lg:flex-wrap lg:items-start lg:gap-x-8 lg:gap-y-4">
                <div className="min-w-0 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">לקוח:</div>
                  <div className="font-medium">{customerName || "—"}</div>
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">טלפון לקוח:</div>
                  {customerPhone ? (
                    <a href={`tel:${customerPhone}`} className="font-medium hover:underline">
                      {customerPhone}
                    </a>
                  ) : (
                    <div className="font-medium">—</div>
                  )}
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">תשלום לקוח:</div>
                  <Badge className={customerPaymentStatusClasses(customerPaymentStatus)}>
                    {customerPaymentStatusLabel(customerPaymentStatus)}
                  </Badge>
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">סטטוס:</div>
                  <div className="font-medium">{status ? projectStatusLabel(status) : "—"}</div>
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">רווח:</div>
                  <div className="font-medium">{formatIls(grossProfit)}</div>
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">משימות פתוחות:</div>
                  <div className="font-medium">{openTasks}</div>
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">התחלה:</div>
                  <div className="font-medium">{formatDate(startDate)}</div>
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">סיום:</div>
                  <div className="font-medium">{formatDate(endDate)}</div>
                </div>
                <div className="col-span-2 min-w-0 space-y-1 lg:col-span-1">
                  <div className="text-xs font-medium text-muted-foreground">מנהל פרויקט:</div>
                  <div className="font-medium">{managerName || "לא הוגדר"}</div>
                </div>
                <div className="hidden min-w-[16rem] max-w-[28rem] space-y-1 lg:block">
                  <div className="text-xs font-medium text-muted-foreground">הערות:</div>
                  <div className="whitespace-pre-wrap font-medium text-sm">
                    {projectNotes || "—"}
                  </div>
                </div>
                {projectType === "moving" ? (
                  <div className="hidden min-w-[16rem] space-y-1 lg:block">
                    <div className="text-xs font-medium text-muted-foreground">פריטים להעברה:</div>
                    {itemsToMove.length > 0 ? (
                      <ul className="list-inside list-disc space-y-1 font-medium">
                        {itemsToMove.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <div className="font-medium text-muted-foreground">לא הוגדרו פריטים.</div>
                    )}
                  </div>
                ) : null}
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
            viewerRole={profile.role}
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
            expenseRecordedByNameByValue={expenseRecordedByNameByValue}
            expenseAuditById={expenseAuditResult.byRecordId}
            payments={paymentsWithPhotos}
            paymentsError={paymentsError}
            morningDocuments={morningDocuments}
            morningDocumentsError={
              projectMorningDocumentsError?.message ?? paymentMorningDocumentsError?.message ?? null
            }
            paymentRecordedByNameByValue={paymentRecordedByNameByValue}
            paymentAuditById={paymentAuditResult.byRecordId}
            paymentAuditError={paymentAuditResult.error}
            workerBalance={workerBalance ?? null}
            salaryAgreements={(salaryAgreements ?? []) as ProjectSalaryAgreement[]}
          />
        )}
      </div>
    </AppShell>
  );
}

