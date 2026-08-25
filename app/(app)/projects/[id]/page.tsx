import dynamic from "next/dynamic";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import ProjectDetailsActions, { REMINDERS_SECTION_ID } from "@/app/(app)/projects/[id]/ProjectDetailsActions";
import { getEntityAuditTrail, getLatestAuditByRecordIds, resolveUserDisplayNamesForValues } from "@/lib/audit";
import EntityActivityTimeline from "@/app/(app)/activity/EntityActivityTimeline";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import ProjectMobileHeader from "@/app/(app)/projects/[id]/ProjectMobileHeader";
import ProjectRemindersSection from "@/app/(app)/projects/[id]/ProjectRemindersSection";
import type { ProjectShareData } from "@/app/(app)/projects/[id]/ProjectShareActions";
import { ArrowLeftIcon, ChevronLeftIcon, ClipboardIcon, DeliveryIcon, HistoryIcon, HomeIcon, LocationIcon, NoteIcon } from "@/components/ui/icons";
import { AddressLink } from "@/components/ui/address-link";
import { StatActionCard } from "@/components/ui/stat-action-card";
import { ProjectStatusPicker } from "@/components/projects/ProjectStatusPicker";
import { ItemsToMoveList } from "@/components/projects/ItemsToMoveList";
import type {
  AssignableUser,
  ExpenseListItem,
  ProjectFinancials,
  ProjectMonthlySalaryItem,
  ProjectOverview,
  ProjectSalaryAgreement,
  ProjectTaskProgress,
  ProjectWorkerBalance,
} from "@/app/(app)/projects/[id]/ProjectTabsClient";
import { formatMovingEndpoint } from "@/lib/projects/movingAddress";
import { PAYMENT_SELECT } from "@/lib/payments";
import { splitPaymentAmounts } from "@/lib/orders/paymentStatus";
import { getProjectStatusLabel } from "@/lib/ui/status-colors";
import type { FinancialAttachment } from "@/lib/payments";
import type { MorningLocalDocument } from "@/lib/morning/types";
import type { WorkSessionRow } from "@/lib/payroll";
import { getCurrentVatRate } from "@/lib/settings/vat";
import { Badge } from "@/components/ui/badge";
import { ContactTapZone } from "@/components/ui/contact-link";
import { CustomerContactCard } from "@/components/customers/CustomerContactCard";
import { formatShortDate } from "@/lib/date";
import { STORAGE_BUCKET } from "@/lib/storage";
import type { SupabaseClient } from "@supabase/supabase-js";

function ProjectTabsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid h-14 grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="animate-pulse rounded-2xl border bg-card/95" />
        ))}
      </div>
      <div className="animate-pulse space-y-3">
        <div className="h-40 rounded-xl border bg-muted/40" />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <div className="h-80 rounded-xl border bg-muted/40" />
          <div className="h-80 rounded-xl border bg-muted/40" />
        </div>
      </div>
    </div>
  );
}

const ProjectTabsClient = dynamic(() => import("@/app/(app)/projects/[id]/ProjectTabsClient"), {
  loading: () => <ProjectTabsSkeleton />,
});

const DOCUMENTS_BUCKET = STORAGE_BUCKET;

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

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Build attachments for a set of document_links, signing ALL their storage keys
// in a single createSignedUrls call (instead of one request per attachment).
async function buildAttachmentsByEntity(
  supabase: SupabaseClient,
  links: UnknownRow[] | null,
  documentById: Map<string, UnknownRow>
): Promise<Map<string, FinancialAttachment[]>> {
  const keys = new Set<string>();
  for (const link of links ?? []) {
    const documentId = typeof link.document_id === "string" ? link.document_id : null;
    if (!documentId) continue;
    const key = getFirstString(documentById.get(documentId), ["storage_key"]);
    if (key) keys.add(key);
  }

  const urlByKey = new Map<string, string>();
  if (keys.size > 0) {
    const { data: signedList } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrls([...keys], 60 * 60);
    (signedList ?? []).forEach((entry) => {
      if (entry && typeof entry.path === "string" && typeof entry.signedUrl === "string") {
        urlByKey.set(entry.path, entry.signedUrl);
      }
    });
  }

  const byEntity = new Map<string, FinancialAttachment[]>();
  for (const link of links ?? []) {
    const entityId = typeof link.entity_id === "string" ? link.entity_id : null;
    const documentId = typeof link.document_id === "string" ? link.document_id : null;
    if (!entityId || !documentId) continue;
    const doc = documentById.get(documentId);
    const storageKey = getFirstString(doc, ["storage_key"]);
    const existing = byEntity.get(entityId) ?? [];
    existing.push({
      document_id: documentId,
      file_name: getFirstString(doc, ["file_name"]),
      storage_key: storageKey,
      uploaded_at: getFirstString(doc, ["uploaded_at"]) ?? getFirstString(link, ["created_at"]),
      document_type: getFirstString(doc, ["document_type"]),
      url: storageKey ? urlByKey.get(storageKey) ?? null : null,
    });
    byEntity.set(entityId, existing);
  }
  return byEntity;
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

// A job that starts and ends on the same day reads as one date, not the same
// date printed twice with a dash between.
function formatDateRange(start: string | null | undefined, end: string | null | undefined) {
  const startText = start ? formatDate(start) : null;
  const endText = end ? formatDate(end) : null;
  if (startText && endText) {
    return startText === endText ? startText : `${startText} – ${endText}`;
  }
  return startText ?? endText ?? null;
}

function userDisplayName(row: UnknownRow | null | undefined) {
  const fullName = getFirstString(row, ["full_name"]);
  if (fullName && fullName.trim()) return fullName.trim();
  const email = getFirstString(row, ["email"]);
  if (email && email.trim()) return email.trim();
  return "משתמש";
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile, supabase } = await requireStaffPage();
  // These reads are all independent (keyed only by the project id), so fetch them
  // in ONE parallel batch instead of ~10 sequential round trips.
  const [
    currentVatRate,
    { data: overviewRaw, error: overviewError },
    { data: projectDetailsRaw },
    { data: financials },
    { data: workerBalance },
    { data: tasks },
    { data: projectTasks },
    { data: assignableUsers },
    { data: customers },
    { data: projectExpenses, error: projectExpensesError },
  ] = await Promise.all([
    getCurrentVatRate(supabase),
    supabase
      .from("project_overview_view")
      .select(
        "id,name,status,project_type,start_date,end_date,agreed_base_price,actual_price,expenses_billed_separately,customer_id,customer_name,project_manager_id,project_manager_name,created_at,updated_at"
      )
      .eq("id", id)
      .maybeSingle<
        Omit<
          ProjectOverview,
          | "notes"
          | "items_to_move"
          | "origin_address"
          | "origin_floor"
          | "origin_has_elevator"
          | "destination_address"
          | "destination_floor"
          | "destination_has_elevator"
        >
      >(),
    supabase
      .from("projects")
      .select("id,notes,items_to_move,origin_address,origin_floor,origin_has_elevator,destination_address,destination_floor,destination_has_elevator,payment_terms,due_date,price_includes_vat,no_charge,vat_rate")
      .eq("id", id)
      .maybeSingle<{
        id: string;
        notes: string | null;
        items_to_move: string[] | null;
        origin_address: string | null;
        origin_floor: string | null;
        origin_has_elevator: boolean | null;
        destination_address: string | null;
        destination_floor: string | null;
        destination_has_elevator: boolean | null;
        payment_terms: string | null;
        due_date: string | null;
        price_includes_vat: boolean | null;
        no_charge: boolean | null;
        vat_rate: number | string | null;
      }>(),
    supabase
      .from("project_financials_view")
      .select("id,agreed_base_price,actual_price,total_expenses,expenses_billed,customer_total_price,gross_profit")
      .eq("id", id)
      .maybeSingle<ProjectFinancials extends infer T ? Exclude<T, null> : never>(),
    supabase
      .from("project_worker_balance_view")
      .select("project_id,earned_amount,paid_amount,owed_amount")
      .eq("project_id", id)
      .maybeSingle<ProjectWorkerBalance extends infer T ? Exclude<T, null> : never>(),
    supabase
      .from("project_task_progress_view")
      .select("project_id,total_tasks,completed_tasks,open_tasks")
      .eq("project_id", id)
      .maybeSingle<ProjectTaskProgress extends infer T ? Exclude<T, null> : never>(),
    supabase
      .from("task_overview_view")
      .select(
        "task_id,subject,status,priority,due_date,project_id,project_name,assigned_user_id,assigned_user_name,created_at,updated_at,is_overdue"
      )
      .eq("project_id", id)
      .order("due_date", { ascending: true })
      .range(0, 199),
    supabase
      .from("users")
      .select("id,full_name,email,role,active,payroll_worker_type,pay_tracking_mode")
      .order("full_name", { ascending: true })
      .range(0, 199),
    supabase
      .from("customer_overview_view")
      .select("customer_id,customer_name,phone")
      .order("customer_name", { ascending: true })
      .range(0, 199),
    supabase
      .from("project_expenses")
      .select("id,project_id,expense_id,included_in_base_price,billed_to_customer,notes")
      .eq("project_id", id)
      .order("id", { ascending: false })
      .range(0, 99),
  ]);

  const overview: ProjectOverview | null = overviewRaw
    ? {
        ...overviewRaw,
        notes: typeof projectDetailsRaw?.notes === "string" ? projectDetailsRaw.notes : null,
        items_to_move: Array.isArray(projectDetailsRaw?.items_to_move)
          ? projectDetailsRaw.items_to_move.filter((item): item is string => typeof item === "string")
          : null,
        origin_address: typeof projectDetailsRaw?.origin_address === "string" ? projectDetailsRaw.origin_address : null,
        origin_floor: typeof projectDetailsRaw?.origin_floor === "string" ? projectDetailsRaw.origin_floor : null,
        origin_has_elevator:
          typeof projectDetailsRaw?.origin_has_elevator === "boolean" ? projectDetailsRaw.origin_has_elevator : null,
        destination_address:
          typeof projectDetailsRaw?.destination_address === "string" ? projectDetailsRaw.destination_address : null,
        destination_floor:
          typeof projectDetailsRaw?.destination_floor === "string" ? projectDetailsRaw.destination_floor : null,
        destination_has_elevator:
          typeof projectDetailsRaw?.destination_has_elevator === "boolean"
            ? projectDetailsRaw.destination_has_elevator
            : null,
        price_includes_vat: projectDetailsRaw?.price_includes_vat === true,
        no_charge: projectDetailsRaw?.no_charge === true,
        vat_rate:
          typeof projectDetailsRaw?.vat_rate === "number"
            ? projectDetailsRaw.vat_rate
            : typeof projectDetailsRaw?.vat_rate === "string"
              ? Number(projectDetailsRaw.vat_rate)
              : null,
      }
    : null;

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
            // due_day_of_next_month is what dates a payslip line in the ledger:
            // the salary is paid on that day of the month AFTER the one it covers.
            "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours,due_day_of_next_month"
          )
          .in("user_id", assignableUserIds)
          .order("valid_from", { ascending: false })
      : { data: [] as ProjectSalaryAgreement[] };

  // Monthly-salary (payslip) costs attributed to THIS project via the worker's
  // salary agreement (business_domain=פרויקטים + project_id). Shown as read-only
  // lines in the project's expenses; the totals come from project_financials_view.
  const monthlySalaryResult = await supabase
    .from("worker_debt_items_view")
    .select("source_id,user_id,period_month,earned_amount,paid_amount,owed_amount,payment_status")
    .eq("source_type", "payslip")
    .eq("project_id", id);
  const monthlySalaryItems: ProjectMonthlySalaryItem[] = (
    (monthlySalaryResult.data ?? []) as Array<Record<string, unknown>>
  ).map((row) => ({
    payslip_id: typeof row.source_id === "string" ? row.source_id : "",
    user_id: typeof row.user_id === "string" ? row.user_id : null,
    period_month: typeof row.period_month === "string" ? row.period_month : null,
    earned_amount: (row.earned_amount as number | string | null) ?? null,
    paid_amount: (row.paid_amount as number | string | null) ?? null,
    owed_amount: (row.owed_amount as number | string | null) ?? null,
    payment_status: typeof row.payment_status === "string" ? row.payment_status : null,
  }));

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
        "id,expense_date,amount,payment_method,payment_status,paid_amount,category,description,business_domain,notes,account_id,recorded_by,created_at,updated_at"
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

  const expenseAttachmentByEntityId = await buildAttachmentsByEntity(
    supabase,
    expenseLinks ?? [],
    expenseDocumentById
  );

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

  // Effective per-session paid status comes from ONE source of truth — the
  // session_effective_payment_view — which already folds in the rule that a paid
  // monthly payslip covers all of that month's sessions (so payslip-mode workers'
  // sessions aren't shown as unpaid). See db/sql/create_session_effective_payment_view.sql.
  // Tolerant: until that view is deployed, fall back to the raw session debt rows
  // (same behaviour as before — session workers keep their status).
  let sessionPaymentRows: Array<Record<string, unknown>> = [];
  if (attendanceSessionIds.length > 0) {
    const effectiveResult = await supabase
      .from("session_effective_payment_view")
      .select("session_id,paid_amount,owed_amount,payment_status,last_payment_date")
      .in("session_id", attendanceSessionIds);
    if (effectiveResult.error) {
      const fallback = await supabase
        .from("worker_debt_items_view")
        .select("source_id,paid_amount,owed_amount,payment_status,last_payment_date")
        .eq("source_type", "session")
        .in("source_id", attendanceSessionIds);
      sessionPaymentRows = ((fallback.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        session_id: row.source_id,
      }));
    } else {
      sessionPaymentRows = (effectiveResult.data ?? []) as Array<Record<string, unknown>>;
    }
  }

  const sessionDebtById = new Map<string, Record<string, unknown>>();
  sessionPaymentRows.forEach((row) => {
    const sessionId = getFirstString(row as UnknownRow, ["session_id"]);
    if (sessionId) sessionDebtById.set(sessionId, row as Record<string, unknown>);
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

  const sessionAttachmentByEntityId = await buildAttachmentsByEntity(
    supabase,
    sessionLinks ?? [],
    sessionDocumentById
  );

  const combinedExpenseList = [
    ...expenseList,
    ...((attendanceSessions ?? []) as AttendanceSessionRow[]).map(
      (session): ExpenseListItem => {
        const effective = sessionDebtById.get(session.id) ?? null;
        const paidAmount = effective?.paid_amount;
        const owedAmount = effective?.owed_amount;
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
            payment_status: typeof effective?.payment_status === "string" ? effective.payment_status : null,
            last_payment_date:
              typeof effective?.last_payment_date === "string" ? effective.last_payment_date : null,
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

  const paymentAttachmentByEntityId = await buildAttachmentsByEntity(
    supabase,
    paymentLinks ?? [],
    paymentDocumentById
  );

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
  // Look the customer's phone up directly by id — the `customers` array above is
  // capped at 200 rows (it only feeds the picker dropdown), so a .find() there
  // misses any customer past the first 200 and wrongly shows "—".
  const overviewCustomerId =
    typeof overview?.customer_id === "string" ? overview.customer_id : null;
  const { data: customerRow } = overviewCustomerId
    ? await supabase
        .from("customer_overview_view")
        .select("phone,email,address,name_for_invoice")
        .eq("customer_id", overviewCustomerId)
        .maybeSingle<{
          phone: string | null;
          email: string | null;
          address: string | null;
          name_for_invoice: string | null;
        }>()
    : { data: null };
  const cleanField = (value: string | null | undefined) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  const customerPhone = cleanField(customerRow?.phone);
  const customerWhatsapp = customerPhone;
  const customerEmail = cleanField(customerRow?.email);
  const customerAddress = cleanField(customerRow?.address);
  const customerInvoiceName = cleanField(customerRow?.name_for_invoice);
  const projectNotes =
    typeof overview?.notes === "string" && overview.notes.trim() ? overview.notes.trim() : null;
  const startDate = typeof overview?.start_date === "string" ? overview.start_date : null;
  const endDate = typeof overview?.end_date === "string" ? overview.end_date : null;
  const projectManagerName =
    typeof overview?.project_manager_name === "string" && overview.project_manager_name.trim()
      ? overview.project_manager_name.trim()
      : null;
  const projectType =
    typeof overview?.project_type === "string" ? overview.project_type : null;
  const itemsToMove = Array.isArray(overview?.items_to_move) ? overview.items_to_move : [];
  const moveOrigin = formatMovingEndpoint({
    address: overview?.origin_address ?? null,
    floor: overview?.origin_floor ?? null,
    hasElevator: overview?.origin_has_elevator ?? null,
  });
  const moveDestination = formatMovingEndpoint({
    address: overview?.destination_address ?? null,
    floor: overview?.destination_floor ?? null,
    hasElevator: overview?.destination_has_elevator ?? null,
  });
  const projectDueDate =
    typeof projectDetailsRaw?.due_date === "string" ? projectDetailsRaw.due_date.slice(0, 10) : null;
  const projectPaymentTerms =
    typeof projectDetailsRaw?.payment_terms === "string" ? projectDetailsRaw.payment_terms : null;
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

  // Per-entity activity timeline (admin only, mirroring /activity access): this
  // project's own changes plus payments and worker sessions logged against it.
  const projectActivity =
    profile.role === "admin" && overview
      ? (
          await getEntityAuditTrail(supabase, [
            { tableName: "projects", recordId: id },
            { tableName: "payments", jsonKey: "project_id", value: id },
            { tableName: "attendance_sessions", jsonKey: "project_id", value: id },
          ])
        ).items
      : [];


  // Desktop side column. The phone renders the same two things itself (the
  // header's customer card and the פרטים section above the tabs).
  // A contact that's actually an email has nothing to dial or WhatsApp.
  // The customer, as a card at the top of the page body — name, how to reach
  // them, and a way through to the customer's own page.
  const customerSideCard = (
    <CustomerContactCard
      customerId={overviewCustomerId}
      name={customerName || "ללא לקוח משויך"}
      invoiceName={customerInvoiceName}
      phone={customerPhone}
      whatsapp={customerWhatsapp}
      email={customerEmail}
      address={customerAddress}
    />
  );

  // The job itself, as the third card of the head row: where it goes, what's
  // being moved, and anything written down about it. Renders only when there IS
  // something to say — otherwise the head row is just לקוח + תשלום.
  const hasRoute = projectType === "moving" && Boolean(moveOrigin || moveDestination);
  const hasItems = projectType === "moving" && itemsToMove.length > 0;
  // Desktop headline: the route on one line, from → to, each behind its own
  // glyph. The row's height is shared with לקוח and תשלום, so the addresses
  // ride the headline instead of costing two rows in the body.
  const routeHeadline = hasRoute ? (
    // Same weight and rhythm as the customer card's name: this IS the card's
    // headline, so it wears the headline's type, not body text.
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-base font-bold leading-snug">
      {moveOrigin ? (
        <AddressLink address={moveOrigin} className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-secondary/10 text-secondary">
            <HomeIcon className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0">{moveOrigin}</span>
        </AddressLink>
      ) : null}
      {moveOrigin && moveDestination ? (
        <ArrowLeftIcon className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
      ) : null}
      {moveDestination ? (
        <AddressLink address={moveDestination} className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success-soft-foreground">
            <LocationIcon className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0">{moveDestination}</span>
        </AddressLink>
      ) : null}
    </span>
  ) : null;

  // A project with no route and no load — a logistics job, say — has nothing to
  // put in this card except what someone wrote about it. Then the note IS the
  // card: a note icon, "הערות", and the text itself, instead of a truck over the
  // words "פרטי העבודה" twice.
  const notesOnlyCard = !hasRoute && !hasItems && Boolean(projectNotes);

  // A שיפוצים / לוגיסטיקה project has no route or load to show, which left the
  // head row with two cards and a hole. This is what the third slot says for
  // those: where the job stands, when it runs, and how far the work has got.
  const taskTotal = Number(tasks?.total_tasks ?? 0) || 0;
  const taskDone = Number(tasks?.completed_tasks ?? 0) || 0;
  const taskPercent = taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : null;
  const projectStatusCard = (
    <StatActionCard
      icon={<ClipboardIcon className="h-5 w-5" />}
      label="סטטוס הפרויקט"
      value={
        <ProjectStatusPicker
          projectId={id}
          status={status}
          canEdit={profile.role === "admin" || profile.role === "office"}
        />
      }
      details={[
        {
          label: "תאריכים",
          value:
            startDate || endDate ? (
              <span dir="ltr">
                {formatDate(startDate)}
                {endDate && endDate !== startDate ? ` – ${formatDate(endDate)}` : ""}
              </span>
            ) : (
              "—"
            ),
        },
        { label: "מנהל פרויקט", value: projectManagerName ?? "לא הוגדר" },
        {
          label: "משימות",
          value:
            taskTotal > 0 ? (
              <span>
                {taskDone}/{taskTotal}
                {taskPercent !== null ? ` · ${taskPercent}%` : ""}
              </span>
            ) : (
              "אין משימות"
            ),
        },
      ]}
    >
      {taskTotal > 0 && taskPercent !== null ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-success" style={{ width: `${taskPercent}%` }} />
        </div>
      ) : null}
    </StatActionCard>
  );

  const detailsSideCard =
    hasRoute || hasItems || projectNotes ? (
      <StatActionCard
        icon={notesOnlyCard ? <NoteIcon className="h-5 w-5" /> : <DeliveryIcon className="h-5 w-5" />}
        label={notesOnlyCard ? "הערות" : projectType === "moving" ? "הובלה" : "פרטי העבודה"}
        // Desktop: the route is the headline (one line, from → to). Phone: no
        // headline at all — the label already says "הובלה" and the route sits
        // right below as stacked rows, so a line reading "פרטי ההובלה" under
        // "הובלה" said the same thing twice. Notes-only cards put the note here.
        // A wrapper element, not a fragment: this subtree is built on the server
        // and handed to a client component, and a fragment's children cross that
        // boundary as a plain array — which React then flags as a keyless list.
        value={
          <span className="block">
            {notesOnlyCard ? (
              <span className="block whitespace-pre-wrap text-base font-bold leading-snug">
                {projectNotes}
              </span>
            ) : null}
            {routeHeadline ? (
              <span className="hidden text-lg font-bold leading-snug lg:block">{routeHeadline}</span>
            ) : null}
            {!notesOnlyCard ? (
              <span className="block text-lg font-bold leading-snug lg:hidden">
                {hasItems
                  ? `${itemsToMove.length} פריטים להעברה`
                  : hasRoute
                    ? "מסלול ההובלה"
                    : "פרטי העבודה"}
              </span>
            ) : null}
          </span>
        }
      >
        <div className="space-y-3">
          {/* Phone keeps the stacked route rows it had — the addresses have the
              full card width here, and the headline above stays the item count.
              On desktop the route moved up into the headline instead. */}
          {hasRoute ? (
            <div className="space-y-2 lg:hidden">
              {moveOrigin ? (
                <AddressLink address={moveOrigin} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-secondary/10 text-secondary">
                    <HomeIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[0.6875rem] text-muted-foreground">מוצא</span>
                    <span className="block font-medium">{moveOrigin}</span>
                  </span>
                </AddressLink>
              ) : null}
              {moveDestination ? (
                <AddressLink address={moveDestination} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success-soft-foreground">
                    <LocationIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[0.6875rem] text-muted-foreground">יעד</span>
                    <span className="block font-medium">{moveDestination}</span>
                  </span>
                </AddressLink>
              ) : null}
            </div>
          ) : null}

          {hasItems ? (
            <div
              className={
                hasRoute ? "border-t border-border/50 pt-3 lg:border-t-0 lg:pt-0" : undefined
              }
            >
              <ItemsToMoveList items={itemsToMove} />
            </div>
          ) : null}

          {/* Skipped when the note is already the card's headline. */}
          {projectNotes && !notesOnlyCard ? (
            <div className="rounded-2xl bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium">הערות: </span>
              <span className="whitespace-pre-wrap">{projectNotes}</span>
            </div>
          ) : null}
        </div>
      </StatActionCard>
    ) : null;

  // What שיתוף / הדפסה send out. Money only for the roles that may see it, and
  // "שולם" is collected money only — same rule as the collection card.
  const canSeeProjectMoney = profile.role === "admin" || profile.role === "office";
  const shareTotal =
    toNumber(financials?.customer_total_price) ??
    toNumber(overview?.actual_price) ??
    toNumber(overview?.agreed_base_price) ??
    0;
  const sharePaid = splitPaymentAmounts(
    ((payments ?? []) as UnknownRow[]).map((payment) => ({
      amount_total: toNumber(payment.amount_total) ?? 0,
      net_amount: toNumber(payment.net_amount),
      payment_status: typeof payment.payment_status === "string" ? payment.payment_status : null,
      due_date: typeof payment.due_date === "string" ? payment.due_date : null,
    }))
  ).collected;
  const projectShareData: ProjectShareData = {
    projectName,
    customerName: customerName || "ללא לקוח",
    customerPhone,
    statusLabel: status ? getProjectStatusLabel(status) : "",
    typeLabel: projectTypeLabel(projectType),
    dateRange: formatDateRange(startDate, endDate),
    managerName: projectManagerName,
    origin: projectType === "moving" ? moveOrigin : null,
    destination: projectType === "moving" ? moveDestination : null,
    itemsToMove,
    notes: projectNotes,
    money: canSeeProjectMoney
      ? { total: shareTotal, paid: sharePaid, balance: Math.max(shareTotal - sharePaid, 0) }
      : null,
  };

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      {/* Phone: ONE vertical rhythm — 0.75rem between the header chips and the
          first card, and between every card, exactly the head row's own gap-3
          (this is the order page's spacing). Desktop keeps the roomier stack. */}
      <div className="space-y-3 md:space-y-5">
        {/* Phone: what the project is, when it runs and who to call. The name is
            in the top bar; the money is in the collection card and סיכום כספי. */}
        <ProjectMobileHeader
          status={status}
          typeLabel={projectTypeLabel(projectType)}
          startDateText={startDate ? formatDate(startDate) : null}
          endDateText={endDate ? formatDate(endDate) : null}
        />

        {/* Desktop heading, same shape as an order: where you are, what this
            is, and the handful of things you can do to it. */}
        <div className="hidden flex-col gap-2 lg:flex">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <nav
                className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground"
                aria-label="ניווט"
              >
                <Link href="/projects" className="hover:text-foreground hover:underline">
                  פרויקטים
                </Link>
                <ChevronLeftIcon className="h-3.5 w-3.5 shrink-0" />
                {overviewCustomerId ? (
                  <Link
                    href={`/customers/${overviewCustomerId}`}
                    className="text-foreground hover:underline"
                  >
                    {customerName || "לקוח"}
                  </Link>
                ) : (
                  <span className="text-foreground">{customerName || "ללא לקוח משויך"}</span>
                )}
                {customerPhone ? (
                  <>
                    <span>·</span>
                    <ContactTapZone
                      kind={customerPhone.includes("@") ? "mailto" : "tel"}
                      value={customerPhone}
                      className="hover:text-foreground hover:underline"
                    >
                      <span dir="ltr">{customerPhone}</span>
                    </ContactTapZone>
                  </>
                ) : null}
              </nav>
              {/* Just the name and the kind of job: status, dates and manager
                  are on the סטטוס הפרויקט card, which every project has now. */}
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight">{projectName}</h1>
                <Badge variant="outline">{projectTypeLabel(projectType)}</Badge>
              </div>
            </div>

            {overview ? (
              <ProjectDetailsActions
                project={overview}
                customerOptions={customerOptions}
                managerOptions={managerOptions}
                projectDocuments={normalizedProjectDocuments}
                projectDocumentsError={projectDocumentsErrorMessage}
                share={projectShareData}
              />
            ) : null}
          </div>
        </div>

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
            currentVatRate={currentVatRate}
            paymentTerms={projectPaymentTerms}
            dueDate={projectDueDate}
            financials={financials ?? null}
            tasks={tasks ?? null}
            projectTasks={projectTasks ?? []}
            projectDocuments={normalizedProjectDocuments}
            projectDocumentsError={projectDocumentsErrorMessage}
            assignableUsers={(assignableUsers as AssignableUser[] | null) ?? []}
            expenses={combinedExpenseList}
            expenseRecordedByNameByValue={expenseRecordedByNameByValue}
            expenseAuditById={expenseAuditResult.byRecordId}
            payments={paymentsWithPhotos}
            morningDocuments={morningDocuments}
            morningDocumentsError={
              projectMorningDocumentsError?.message ?? paymentMorningDocumentsError?.message ?? null
            }
            paymentRecordedByNameByValue={paymentRecordedByNameByValue}
            paymentAuditById={paymentAuditResult.byRecordId}
            workerBalance={workerBalance ?? null}
            salaryAgreements={(salaryAgreements ?? []) as ProjectSalaryAgreement[]}
            monthlySalaryItems={monthlySalaryItems}
            moneyError={
              projectExpensesError?.message ??
              expensesError?.message ??
              attendanceSessionsError?.message ??
              paymentsError ??
              null
            }
            customerCard={customerSideCard}
            detailsCard={detailsSideCard}
            statusCard={projectStatusCard}
            activitySection={
              profile.role === "admin" ? (
                <CollapsibleSection
                  defaultOpen
                  title="היסטוריית פעילות"
                  icon={<HistoryIcon className="h-4 w-4 text-primary" />}
                  summary={
                    projectActivity.length > 0 ? (
                      <span className="text-muted-foreground">{projectActivity.length} רשומות</span>
                    ) : null
                  }
                >
                  <EntityActivityTimeline items={projectActivity} previewCount={5} />
                </CollapsibleSection>
              ) : null
            }
            remindersSection={
              profile.role === "admin" || profile.role === "office" ? (
                <ProjectRemindersSection
                  id={REMINDERS_SECTION_ID}
                  projectId={id}
                  customerId={typeof overview.customer_id === "string" ? overview.customer_id : undefined}
                  canManage
                />
              ) : null
            }
          />
        )}

        {/* Phone: the same actions, as the top bar's ⋮ menu. Renders nothing on
            the page itself — it only registers the menu (and keeps its dialogs
            mounted). */}
        {overview ? (
          <ProjectDetailsActions
            project={overview}
            customerOptions={customerOptions}
            managerOptions={managerOptions}
            projectDocuments={normalizedProjectDocuments}
            projectDocumentsError={projectDocumentsErrorMessage}
            share={projectShareData}
            layout="menu"
          />
        ) : null}

      </div>
    </AppShell>
  );
}

