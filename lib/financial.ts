import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveUserDisplayNamesForValues } from "@/lib/audit";
import {
  getBusinessDomainLabel,
  isExpenseBusinessDomain,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import { paymentMethodLabel } from "@/lib/orders/paymentStatus";

type PaymentRow = {
  id: string;
  payment_date: string | null;
  due_date: string | null;
  amount_total: number | string | null;
  payment_method: string | null;
  payment_status: string | null;
  reference_number: string | null;
  business_domain: string | null;
  notes: string | null;
  project_id: string | null;
  order_id: string | null;
  property_id: string | null;
  target_type: string | null;
  target_id: string | null;
  recorded_by: string | null;
};

type ExpenseRow = {
  id: string;
  expense_date: string | null;
  amount: number | string | null;
  category: string | null;
  description: string | null;
  business_domain: string | null;
  notes: string | null;
  project_id: string | null;
  order_id: string | null;
  property_id: string | null;
  recorded_by: string | null;
};

type OrderRow = {
  id: string;
  customer_id: string | null;
  order_date?: string | null;
  status?: string | null;
  total_amount?: number | string | null;
  payment_status?: string | null;
};

type ProjectRow = {
  id: string;
  name: string | null;
  customer_id: string | null;
  agreed_base_price?: number | string | null;
  actual_price?: number | string | null;
  created_at?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
};

type PropertyRow = {
  id: string;
  address: string | null;
};

type ProjectFinancialRow = {
  id: string;
  customer_total_price: number | string | null;
  expenses_billed: number | string | null;
};

type OrderFinancialRow = {
  id: string;
  order_id?: string | null;
  total_amount: number | string | null;
  total_paid: number | string | null;
  remaining_balance: number | string | null;
  payment_status: string | null;
};

type LeaseAgreementRow = {
  property_id: string | null;
  customer_id: string | null;
};

type ProjectExpenseLinkRow = {
  expense_id: string | null;
  project_id: string | null;
};

type WorkerPaymentRow = {
  id: string;
  user_id: string | null;
  payment_date: string | null;
  amount: number | string | null;
  payment_method: string | null;
  reference_number: string | null;
  notes: string | null;
  recorded_by: string | null;
};

type WorkerPaymentAllocationRow = {
  id: string;
  worker_payment_id: string | null;
  source_type: string | null;
  attendance_session_id: string | null;
  payslip_id: string | null;
  amount: number | string | null;
};

type AttendanceSessionFinanceRow = {
  id: string;
  user_id: string | null;
  clock_in: string | null;
  business_domain: string | null;
  project_id: string | null;
  property_id: string | null;
  labor_cost: number | string | null;
  paid_amount: number | string | null;
  owed_amount: number | string | null;
  payment_status: string | null;
};

type WorkerUserRow = {
  id: string;
  pay_tracking_mode: string | null;
};

type SalaryAgreementLiteRow = {
  id: string;
  user_id: string | null;
  salary_type: string | null;
  hourly_rate: number | string | null;
  monthly_salary: number | string | null;
  valid_from: string | null;
  valid_to: string | null;
};

export type FinancialPageFilters = {
  customerId?: string | null;
  from?: string | null;
  to?: string | null;
  domain?: string | null;
  sourceId?: string | null;
  type?: string | null;
  stage?: string | null;
  q?: string | null;
  ledgerPage?: number | null;
  upcomingPage?: number | null;
};

export type FinancialEntryType = "inflow" | "outflow";
export type FinancialEntryStage = "posted" | "scheduled" | "pending";
export type FinancialSourceKind = "project" | "property" | "order" | "general";
export type FinancialEntryOrigin =
  | "payment"
  | "expense"
  | "worker_payment"
  | "worker_owed"
  | "project_receivable"
  | "order_receivable";

export type FinancialEntry = {
  id: string;
  type: FinancialEntryType;
  amount: number;
  signedAmount: number;
  businessDomain: ExpenseBusinessDomain | null;
  domainName: string;
  flowDate: string;
  recordedDate: string | null;
  dueDate: string | null;
  stage: FinancialEntryStage;
  sourceKind: FinancialSourceKind;
  sourceId: string | null;
  sourceLabel: string;
  sourceHref: string | null;
  description: string;
  origin: FinancialEntryOrigin;
  reference: string | null;
  paymentMethod: string | null;
  paymentMethodLabel: string | null;
  paymentStatus: string | null;
  recordedByName: string | null;
  customerId: string | null;
  searchText: string;
};

export type FinancialSummary = {
  inflow: number;
  outflow: number;
  net: number;
  count: number;
};

export type FinancialDomainGroup = {
  domain: ExpenseBusinessDomain | null;
  domainName: string;
  actual: FinancialSummary;
  future: FinancialSummary;
  total: FinancialSummary;
};

export type FinancialPageData = {
  todayIso: string;
  actualSummary: FinancialSummary;
  futureSummary: FinancialSummary;
  totalSummary: FinancialSummary;
  forecastSummary: FinancialSummary;
  forecastEndIso: string;
  openReceivablesSummary: FinancialSummary;
  plannedReceivablesSummary: FinancialSummary;
  openLiabilitiesSummary: FinancialSummary;
  scheduledLiabilitiesSummary: FinancialSummary;
  domainGroups: FinancialDomainGroup[];
  domainOptions: ExpenseBusinessDomain[];
  sourceKind: FinancialSourceKind | null;
  sourceOptions: Array<{ id: string; label: string }>;
  sourceCount: number;
  ledgerEntries: FinancialEntry[];
  ledgerTotalCount: number;
  ledgerPage: number;
  ledgerTotalPages: number;
  upcomingEntries: FinancialEntry[];
  upcomingTotalCount: number;
  upcomingPage: number;
  upcomingTotalPages: number;
};

const SCAN_CHUNK_SIZE = 500;
const ID_CHUNK_SIZE = 200;
const LEDGER_PAGE_SIZE = 25;
const UPCOMING_PAGE_SIZE = 15;

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function normalizeDate(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const isoPrefix = trimmed.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(isoPrefix) ? isoPrefix : null;
}

function normalizeDomain(value: string | null | undefined): ExpenseBusinessDomain | null {
  if (!value) return null;
  const trimmed = value.trim();
  return isExpenseBusinessDomain(trimmed) ? trimmed : null;
}

function normalizeCustomerId(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeText(value: string | null | undefined) {
  if (!value) return "";
  return value.trim().toLowerCase();
}

function normalizePositiveInteger(value: number | string | null | undefined, fallback = 1) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric < 1) return fallback;
  return Math.floor(numeric);
}

function addDaysToIso(isoDate: string, days: number) {
  const base = new Date(`${isoDate}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function normalizePaymentMethod(method: string | null | undefined) {
  const raw = typeof method === "string" ? method.trim() : "";
  if (!raw) return "";

  const normalized = raw.toLowerCase();
  if (normalized === "check" || normalized === "cheque" || raw.includes("צ'ק")) return "check";
  return normalized;
}

function normalizePaymentStatus(status: string | null | undefined) {
  const value = typeof status === "string" ? status.trim().toLowerCase() : "";
  return value || null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function isFutureEntry(entry: FinancialEntry, referenceDate: string) {
  return entry.flowDate > referenceDate || entry.stage !== "posted";
}

function domainToSourceKind(domain: ExpenseBusinessDomain | null) {
  if (domain === "logistics_projects") return "project" as const;
  if (domain === "property_management") return "property" as const;
  if (domain === "sales") return "order" as const;
  return null;
}

function chunkStrings(values: string[], chunkSize: number) {
  const chunks: string[][] = [];

  for (let start = 0; start < values.length; start += chunkSize) {
    chunks.push(values.slice(start, start + chunkSize));
  }

  return chunks;
}

function isMissingColumnError(error: unknown, columnName: string) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : null;
  const message = "message" in error ? error.message : null;
  return (
    code === "42703" &&
    typeof message === "string" &&
    message.toLowerCase().includes(columnName.toLowerCase())
  );
}

function isPermissionDeniedError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : null;
  const message = "message" in error ? error.message : null;
  return (
    code === "42501" ||
    (typeof message === "string" &&
      (message.toLowerCase().includes("permission denied") ||
        message.toLowerCase().includes("row-level security")))
  );
}

async function scanRows<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  table: string,
  selectColumns: string,
  dateColumn: string
) {
  const rows: T[] = [];

  for (let rangeStart = 0; ; rangeStart += SCAN_CHUNK_SIZE) {
    const rangeEnd = rangeStart + SCAN_CHUNK_SIZE - 1;
    const { data, error } = await supabase
      .from(table)
      .select(selectColumns)
      .not(dateColumn, "is", null)
      .order(dateColumn, { ascending: false })
      .order("id", { ascending: false })
      .range(rangeStart, rangeEnd);

    if (error) throw error;

    const chunk = (data ?? []) as unknown as T[];
    if (chunk.length === 0) break;

    rows.push(...chunk);

    if (chunk.length < SCAN_CHUNK_SIZE) break;
  }

  return rows;
}

async function scanPaymentRows(supabase: SupabaseClient) {
  const selectVariants = [
    "id,payment_date,due_date,amount_total,payment_method,payment_status,reference_number,business_domain,notes,project_id,order_id,property_id,target_type,target_id,recorded_by",
    "id,payment_date,due_date,amount_total,payment_method,payment_status,reference_number,business_domain,notes,project_id,order_id,property_id,recorded_by",
    "id,payment_date,due_date,amount_total,payment_method,payment_status,reference_number,business_domain,notes,target_type,target_id,recorded_by",
    "id,payment_date,due_date,amount_total,payment_method,payment_status,reference_number,business_domain,notes,recorded_by",
    "id,payment_date,amount_total,payment_method,reference_number,business_domain,notes,recorded_by",
  ] as const;

  let lastError: unknown = null;

  for (const selectColumns of selectVariants) {
    try {
      return await scanRows<PaymentRow>(supabase, "payments", selectColumns, "payment_date");
    } catch (error) {
      lastError = error;
      if (
        isMissingColumnError(error, "target_type") ||
        isMissingColumnError(error, "target_id") ||
        isMissingColumnError(error, "project_id") ||
        isMissingColumnError(error, "order_id") ||
        isMissingColumnError(error, "property_id") ||
        isMissingColumnError(error, "due_date") ||
        isMissingColumnError(error, "payment_status")
      ) {
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

async function scanWorkerPaymentRows(supabase: SupabaseClient) {
  return scanRows<WorkerPaymentRow>(
    supabase,
    "worker_payments",
    "id,user_id,payment_date,amount,payment_method,reference_number,notes,recorded_by",
    "payment_date"
  );
}

async function fetchProjectsByIds(supabase: SupabaseClient, ids: string[]) {
  const map = new Map<string, ProjectRow>();

  for (const chunk of chunkStrings(uniqueStrings(ids), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("projects")
      .select("id,name,customer_id,status,start_date,end_date")
      .in("id", chunk);

    if (error) throw error;

    ((data ?? []) as ProjectRow[]).forEach((row) => {
      if (row.id) map.set(row.id, row);
    });
  }

  return map;
}

async function scanProjectRows(supabase: SupabaseClient) {
  return scanRows<ProjectRow>(
    supabase,
    "projects",
    "id,name,customer_id,agreed_base_price,actual_price,created_at,start_date,end_date,status",
    "created_at"
  );
}

async function fetchOrdersByIds(supabase: SupabaseClient, ids: string[]) {
  const map = new Map<string, OrderRow>();

  for (const chunk of chunkStrings(uniqueStrings(ids), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("orders")
      .select("id,customer_id,order_date,status,total_amount,payment_status")
      .in("id", chunk);

    if (error) throw error;

    ((data ?? []) as OrderRow[]).forEach((row) => {
      if (row.id) map.set(row.id, row);
    });
  }

  return map;
}

async function scanOrderRows(supabase: SupabaseClient) {
  return scanRows<OrderRow>(
    supabase,
    "orders",
    "id,customer_id,order_date,status,total_amount,payment_status",
    "order_date"
  );
}

async function fetchPropertiesByIds(supabase: SupabaseClient, ids: string[]) {
  const map = new Map<string, PropertyRow>();

  for (const chunk of chunkStrings(uniqueStrings(ids), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("properties")
      .select("id,address")
      .in("id", chunk);

    if (error) throw error;

    ((data ?? []) as PropertyRow[]).forEach((row) => {
      if (row.id) map.set(row.id, row);
    });
  }

  return map;
}

async function fetchPropertyCustomerLinks(supabase: SupabaseClient, propertyIds: string[]) {
  const map = new Map<string, Set<string>>();

  for (const chunk of chunkStrings(uniqueStrings(propertyIds), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("lease_agreements")
      .select("property_id,customer_id")
      .in("property_id", chunk);

    if (error) throw error;

    ((data ?? []) as LeaseAgreementRow[]).forEach((row) => {
      if (!row.property_id || !row.customer_id) return;
      const current = map.get(row.property_id) ?? new Set<string>();
      current.add(row.customer_id);
      map.set(row.property_id, current);
    });
  }

  return map;
}

async function fetchProjectFinancialsByIds(supabase: SupabaseClient, projectIds: string[]) {
  const map = new Map<string, ProjectFinancialRow>();

  for (const chunk of chunkStrings(uniqueStrings(projectIds), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("project_financials_view")
      .select("id,customer_total_price,expenses_billed")
      .in("id", chunk);

    if (error) throw error;

    ((data ?? []) as ProjectFinancialRow[]).forEach((row) => {
      if (row.id) map.set(row.id, row);
    });
  }

  return map;
}

async function fetchOrderFinancialsByIds(supabase: SupabaseClient, orderIds: string[]) {
  const safeOrderIds = uniqueStrings(orderIds);
  const map = new Map<string, OrderFinancialRow>();
  const selectVariants = [
    {
      select: "id,total_amount,total_paid,remaining_balance,payment_status",
      idColumn: "id",
      readId: (row: OrderFinancialRow) => row.id,
    },
    {
      select: "order_id,total_amount,total_paid,remaining_balance,payment_status",
      idColumn: "order_id",
      readId: (row: OrderFinancialRow) => row.order_id ?? null,
    },
    {
      select: "id,total_amount,remaining_balance,payment_status",
      idColumn: "id",
      readId: (row: OrderFinancialRow) => row.id,
    },
    {
      select: "order_id,total_amount,remaining_balance,payment_status",
      idColumn: "order_id",
      readId: (row: OrderFinancialRow) => row.order_id ?? null,
    },
    {
      select: "id,total_amount,remaining_balance",
      idColumn: "id",
      readId: (row: OrderFinancialRow) => row.id,
    },
    {
      select: "order_id,total_amount,remaining_balance",
      idColumn: "order_id",
      readId: (row: OrderFinancialRow) => row.order_id ?? null,
    },
  ] as const;

  let lastError: unknown = null;

  for (const variant of selectVariants) {
    try {
      for (const chunk of chunkStrings(safeOrderIds, ID_CHUNK_SIZE)) {
        const { data, error } = await supabase
          .from("order_financials_view")
          .select(variant.select)
          .in(variant.idColumn, chunk);

        if (error) throw error;

        ((data ?? []) as unknown as OrderFinancialRow[]).forEach((row) => {
          const id = variant.readId(row);
          if (!id) return;
          map.set(id, { ...row, id });
        });
      }

      return map;
    } catch (error) {
      lastError = error;
      if (
        isMissingColumnError(error, "id") ||
        isMissingColumnError(error, "order_id") ||
        isMissingColumnError(error, "total_paid") ||
        isMissingColumnError(error, "remaining_balance") ||
        isMissingColumnError(error, "payment_status")
      ) {
        map.clear();
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

async function fetchProjectExpenseLinksByExpenseIds(supabase: SupabaseClient, expenseIds: string[]) {
  const map = new Map<string, string>();

  for (const chunk of chunkStrings(uniqueStrings(expenseIds), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("project_expenses")
      .select("expense_id,project_id")
      .in("expense_id", chunk);

    if (error) throw error;

    ((data ?? []) as ProjectExpenseLinkRow[]).forEach((row) => {
      if (!row.expense_id || !row.project_id || map.has(row.expense_id)) return;
      map.set(row.expense_id, row.project_id);
    });
  }

  return map;
}

async function fetchWorkerUsersByIds(supabase: SupabaseClient, userIds: string[]) {
  const map = new Map<string, WorkerUserRow>();

  for (const chunk of chunkStrings(uniqueStrings(userIds), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("users")
      .select("id,pay_tracking_mode")
      .in("id", chunk);

    if (error) throw error;

    ((data ?? []) as WorkerUserRow[]).forEach((row) => {
      if (row.id) map.set(row.id, row);
    });
  }

  return map;
}

async function fetchSalaryAgreementsByUserIds(supabase: SupabaseClient, userIds: string[]) {
  const rows: SalaryAgreementLiteRow[] = [];

  for (const chunk of chunkStrings(uniqueStrings(userIds), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("salary_agreements")
      .select("id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to")
      .in("user_id", chunk);

    if (error) throw error;
    rows.push(...((data ?? []) as SalaryAgreementLiteRow[]));
  }

  return rows;
}

async function fetchWorkerPaymentAllocationsByPaymentIds(
  supabase: SupabaseClient,
  workerPaymentIds: string[]
) {
  const rows: WorkerPaymentAllocationRow[] = [];

  for (const chunk of chunkStrings(uniqueStrings(workerPaymentIds), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("worker_payment_allocations")
      .select("id,worker_payment_id,source_type,attendance_session_id,payslip_id,amount")
      .in("worker_payment_id", chunk);

    if (error) throw error;
    rows.push(...((data ?? []) as WorkerPaymentAllocationRow[]));
  }

  return rows;
}

async function scanAttendanceSessionRows(supabase: SupabaseClient) {
  const selectVariants = [
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,paid_amount,owed_amount,payment_status",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,paid_amount,owed_amount",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,paid_amount,payment_status",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,owed_amount,payment_status",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,paid_amount",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,owed_amount",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost,payment_status",
    "id,user_id,clock_in,business_domain,project_id,property_id,labor_cost",
    "id,user_id,clock_in,business_domain,project_id,property_id",
  ] as const;

  let lastError: unknown = null;

  for (const selectColumns of selectVariants) {
    try {
      return await scanRows<AttendanceSessionFinanceRow>(
        supabase,
        "attendance_sessions",
        selectColumns,
        "clock_in"
      );
    } catch (error) {
      lastError = error;
      if (
        isMissingColumnError(error, "paid_amount") ||
        isMissingColumnError(error, "owed_amount") ||
        isMissingColumnError(error, "payment_status") ||
        isMissingColumnError(error, "labor_cost") ||
        isMissingColumnError(error, "project_id") ||
        isMissingColumnError(error, "property_id") ||
        isMissingColumnError(error, "business_domain")
      ) {
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

async function resolveCustomerProjectIds(
  supabase: SupabaseClient,
  customerId: string | null
) {
  if (!customerId) return [] as string[];

  const { data, error } = await supabase.from("projects").select("id").eq("customer_id", customerId);
  if (error) throw error;

  return ((data ?? []) as Array<{ id?: string | null }>)
    .map((row) => (typeof row.id === "string" ? row.id : null))
    .filter((value): value is string => Boolean(value));
}

function matchesCustomerFilter(args: {
  customerId: string | null;
  customerProjectIds: Set<string>;
  projectId: string | null;
  orderCustomerId: string | null;
  propertyCustomerIds: Set<string> | null;
  projectCustomerId: string | null;
}) {
  const {
    customerId,
    customerProjectIds,
    projectId,
    orderCustomerId,
    propertyCustomerIds,
    projectCustomerId,
  } = args;

  if (!customerId) return true;

  if (projectId) {
    return projectCustomerId === customerId || customerProjectIds.has(projectId);
  }

  if (orderCustomerId) {
    return orderCustomerId === customerId;
  }

  if (propertyCustomerIds) {
    return propertyCustomerIds.has(customerId);
  }

  return false;
}

function buildPaymentFlowMeta(row: PaymentRow, referenceDate: string) {
  const paymentDate = normalizeDate(row.payment_date);
  const dueDate = normalizeDate(row.due_date);
  const method = normalizePaymentMethod(row.payment_method);
  const status = normalizePaymentStatus(row.payment_status);
  const isCheck = method === "check";
  const flowDate = isCheck && dueDate ? dueDate : paymentDate;

  if (!flowDate) return null;

  const stage: FinancialEntryStage =
    isCheck && status !== "cleared"
      ? flowDate > referenceDate
        ? "scheduled"
        : "pending"
      : flowDate > referenceDate
        ? "scheduled"
        : "posted";

  return {
    flowDate,
    paymentDate,
    dueDate,
    stage,
    method,
    status,
  };
}

function buildExpenseFlowMeta(row: ExpenseRow, referenceDate: string) {
  const expenseDate = normalizeDate(row.expense_date);
  if (!expenseDate) return null;

  return {
    flowDate: expenseDate,
    recordedDate: expenseDate,
    stage: expenseDate > referenceDate ? ("scheduled" as const) : ("posted" as const),
  };
}

function buildWorkerPaymentFlowMeta(paymentDateValue: string | null | undefined, referenceDate: string) {
  const paymentDate = normalizeDate(paymentDateValue);
  if (!paymentDate) return null;

  return {
    flowDate: paymentDate,
    recordedDate: paymentDate,
    stage: paymentDate > referenceDate ? ("scheduled" as const) : ("posted" as const),
  };
}

function buildSource(args: {
  businessDomain: ExpenseBusinessDomain | null;
  projectId: string | null;
  orderId: string | null;
  propertyId: string | null;
  projectName: string | null;
  propertyAddress: string | null;
}) {
  const { businessDomain, projectId, orderId, propertyId, projectName, propertyAddress } = args;

  if (projectId) {
    return {
      kind: "project" as const,
      id: projectId,
      label: projectName || `פרויקט ${projectId.slice(0, 8)}`,
      href: `/projects/${projectId}`,
    };
  }

  if (propertyId) {
    return {
      kind: "property" as const,
      id: propertyId,
      label: propertyAddress || `נכס ${propertyId.slice(0, 8)}`,
      href: "/properties",
    };
  }

  if (orderId) {
    return {
      kind: "order" as const,
      id: orderId,
      label: `הזמנה ${orderId.slice(0, 8)}`,
      href: `/sales/orders/${orderId}`,
    };
  }

  if (businessDomain === "property_management") {
    return {
      kind: "general" as const,
      id: null,
      label: "פעילות נכסים כללית",
      href: null,
    };
  }

  if (businessDomain === "sales") {
    return {
      kind: "general" as const,
      id: null,
      label: "פעילות מכירות כללית",
      href: null,
    };
  }

  return {
    kind: "general" as const,
    id: null,
    label: "פעילות כללית",
    href: null,
  };
}

function resolvePaymentLinks(row: PaymentRow) {
  const targetType = typeof row.target_type === "string" ? row.target_type.trim() : "";
  const targetId = typeof row.target_id === "string" ? row.target_id.trim() : "";

  const projectId =
    row.project_id?.trim() ||
    (targetType === "project" && targetId ? targetId : null);
  const orderId =
    row.order_id?.trim() ||
    (targetType === "order" && targetId ? targetId : null);
  const propertyId =
    row.property_id?.trim() ||
    (targetType === "property" && targetId ? targetId : null);

  return {
    projectId,
    orderId,
    propertyId,
  };
}

function buildPaymentDescription(row: PaymentRow) {
  const notes = row.notes?.trim();
  if (notes) return notes;

  const referenceNumber = row.reference_number?.trim();
  if (referenceNumber) return referenceNumber;

  const method = row.payment_method?.trim();
  if (method) return paymentMethodLabel(method);

  return "תשלום";
}

function buildExpenseDescription(row: ExpenseRow) {
  const description = row.description?.trim();
  if (description) return description;

  const notes = row.notes?.trim();
  if (notes) return notes;

  const category = row.category?.trim();
  if (category) return category;

  return "הוצאה";
}

function buildWorkerPaymentDescription(workerName: string | null) {
  return workerName
    ? `\u05e9\u05db\u05e8 \u05e2\u05d5\u05d1\u05d3 \u2014 ${workerName}`
    : "\u05e9\u05db\u05e8 \u05e2\u05d5\u05d1\u05d3";
}

function buildWorkerOwedFlowMeta(clockInValue: string | null | undefined) {
  const recordedDate = normalizeDate(clockInValue);
  return {
    flowDate: recordedDate || todayIso(),
    dueDate: recordedDate,
    recordedDate,
    stage: "pending" as const,
  };
}

function buildReceivableFlowMeta(recordedDateValue: string | null | undefined, referenceDate: string) {
  const recordedDate = normalizeDate(recordedDateValue);
  return {
    flowDate: recordedDate || referenceDate,
    dueDate: recordedDate,
    recordedDate,
    stage: "pending" as const,
  };
}

function normalizeStatusValue(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isClosedProjectStatus(status: string | null | undefined) {
  const value = normalizeStatusValue(status);
  return value === "completed";
}

function isExcludedProjectStatus(status: string | null | undefined) {
  const value = normalizeStatusValue(status);
  return value === "cancelled" || value === "canceled" || value === "quote";
}

function isClosedOrderStatus(status: string | null | undefined) {
  const value = normalizeStatusValue(status);
  return value === "delivered" || value === "completed" || value === "closed";
}

function isExcludedOrderStatus(status: string | null | undefined) {
  const value = normalizeStatusValue(status);
  return value === "cancelled" || value === "canceled";
}

function buildPlannedReceivableFlowMeta(
  candidates: Array<string | null | undefined>,
  referenceDate: string
) {
  const dates = candidates
    .map(normalizeDate)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right));
  const recordedDate = dates[0] ?? null;
  const flowDate = recordedDate && recordedDate > referenceDate ? recordedDate : referenceDate;

  return {
    flowDate,
    dueDate: recordedDate,
    recordedDate,
    stage: "scheduled" as const,
  };
}

function monthKeyFromIso(isoDate: string | null | undefined) {
  const normalized = normalizeDate(isoDate);
  return normalized ? normalized.slice(0, 7) : "";
}

function nextMonthDueDate(isoDate: string | null | undefined, dayOfMonth: number) {
  const normalized = normalizeDate(isoDate);
  if (!normalized) return null;

  const [yearText, monthText] = normalized.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;

  const baseMonthIndex = month;
  const nextYear = baseMonthIndex === 12 ? year + 1 : year;
  const nextMonth = baseMonthIndex === 12 ? 1 : baseMonthIndex + 1;

  return recurringExpenseClampedDate(nextYear, nextMonth, dayOfMonth);
}

function recurringExpenseClampedDate(year: number, month: number, day: number) {
  const safeMonth = Math.min(Math.max(month, 1), 12);
  const lastDay = new Date(Date.UTC(year, safeMonth, 0)).getUTCDate();
  const safeDay = Math.min(Math.max(day, 1), lastDay);
  return `${year}-${String(safeMonth).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function buildMonthlyWorkerOwedFlowMeta(clockInValue: string | null | undefined, referenceDate: string) {
  const recordedDate = normalizeDate(clockInValue);
  const dueDate = nextMonthDueDate(recordedDate, 10);
  const flowDate = dueDate ?? recordedDate ?? todayIso();

  return {
    flowDate,
    dueDate,
    recordedDate,
    stage: flowDate > referenceDate ? ("scheduled" as const) : ("pending" as const),
  };
}

function isAgreementActiveOnDate(
  agreement: SalaryAgreementLiteRow,
  referenceDateValue: string | null | undefined
) {
  const userId = agreement.user_id?.trim();
  const validFrom = normalizeDate(agreement.valid_from);
  if (!userId || !validFrom) return false;

  const point = normalizeDate(referenceDateValue) ?? todayIso();
  if (validFrom > point) return false;

  const validTo = normalizeDate(agreement.valid_to);
  if (validTo && validTo < point) return false;

  return true;
}

function shouldAggregateWorkerDebt(args: {
  worker: WorkerUserRow | null;
  agreements: SalaryAgreementLiteRow[];
  sessionDate: string | null | undefined;
}) {
  const trackingMode = args.worker?.pay_tracking_mode?.trim().toLowerCase() ?? "";
  if (trackingMode === "payslip") return true;

  return args.agreements.some(
    (agreement) =>
      agreement.salary_type?.trim().toLowerCase() === "hourly" &&
      isAgreementActiveOnDate(agreement, args.sessionDate)
  );
}

function createEmptySummary(): FinancialSummary {
  return {
    inflow: 0,
    outflow: 0,
    net: 0,
    count: 0,
  };
}

function summarizeEntries(entries: FinancialEntry[]) {
  const summary = createEmptySummary();

  entries.forEach((entry) => {
    if (entry.type === "inflow") summary.inflow += entry.amount;
    if (entry.type === "outflow") summary.outflow += entry.amount;
    summary.net += entry.signedAmount;
    summary.count += 1;
  });

  return summary;
}

function buildDomainGroups(entries: FinancialEntry[], referenceDate: string) {
  const groups = new Map<string, FinancialDomainGroup>();

  entries.forEach((entry) => {
    const key = entry.businessDomain ?? "__unassigned__";
    const current = groups.get(key) ?? {
      domain: entry.businessDomain,
      domainName: entry.domainName,
      actual: createEmptySummary(),
      future: createEmptySummary(),
      total: createEmptySummary(),
    };

    const bucket =
      entry.flowDate > referenceDate || entry.stage !== "posted" ? current.future : current.actual;

    if (entry.type === "inflow") {
      bucket.inflow += entry.amount;
      current.total.inflow += entry.amount;
    } else {
      bucket.outflow += entry.amount;
      current.total.outflow += entry.amount;
    }

    bucket.net += entry.signedAmount;
    bucket.count += 1;
    current.total.net += entry.signedAmount;
    current.total.count += 1;

    groups.set(key, current);
  });

  return Array.from(groups.values()).sort(
    (left, right) =>
      Math.abs(right.total.net) - Math.abs(left.total.net) ||
      right.total.count - left.total.count
  );
}

function matchesEntryFilters(
  entry: FinancialEntry,
  filters: {
    from: string | null;
    to: string | null;
    domain: ExpenseBusinessDomain | null;
    sourceId: string | null;
    type: FinancialEntryType | null;
    stage: "actual" | "future" | "pending" | null;
    query: string;
    referenceDate: string;
  }
) {
  if (filters.from && entry.flowDate < filters.from) return false;
  if (filters.to && entry.flowDate > filters.to) return false;
  if (filters.domain && entry.businessDomain !== filters.domain) return false;
  if (filters.sourceId && entry.sourceId !== filters.sourceId) return false;
  if (filters.type && entry.type !== filters.type) return false;

  if (filters.stage === "actual" && isFutureEntry(entry, filters.referenceDate)) return false;
  if (filters.stage === "future" && !isFutureEntry(entry, filters.referenceDate)) return false;
  if (filters.stage === "pending" && entry.stage !== "pending") return false;

  if (!filters.query) return true;
  return entry.searchText.includes(filters.query);
}

function paginateEntries(entries: FinancialEntry[], page: number, pageSize: number) {
  const totalCount = entries.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * pageSize;

  return {
    entries: entries.slice(start, start + pageSize),
    totalCount,
    page: currentPage,
    totalPages,
  };
}

function sortEntries(entries: FinancialEntry[]) {
  return [...entries].sort((left, right) => {
    const dateCompare = right.flowDate.localeCompare(left.flowDate);
    if (dateCompare !== 0) return dateCompare;
    return right.id.localeCompare(left.id);
  });
}

export async function getFinancialPageData(
  supabase: SupabaseClient,
  filters: FinancialPageFilters = {}
): Promise<FinancialPageData> {
  const customerId = normalizeCustomerId(filters.customerId);
  const referenceDate = todayIso();
  const from = normalizeDate(filters.from);
  const to = normalizeDate(filters.to);
  const domain = normalizeDomain(filters.domain);
  const sourceId = normalizeCustomerId(filters.sourceId);
  const type =
    filters.type === "inflow" || filters.type === "outflow" ? filters.type : null;
  const stage =
    filters.stage === "actual" || filters.stage === "future" || filters.stage === "pending"
      ? filters.stage
      : null;
  const query = normalizeText(filters.q);
  const ledgerPage = normalizePositiveInteger(filters.ledgerPage, 1);
  const upcomingPage = normalizePositiveInteger(filters.upcomingPage, 1);
  const customerProjectIds = await resolveCustomerProjectIds(supabase, customerId);
  const customerProjectSet = new Set(customerProjectIds);

  const [paymentRows, expenseRows, workerPaymentsResult, projectRows, orderRows] = await Promise.all([
    scanPaymentRows(supabase),
    scanRows<ExpenseRow>(
      supabase,
      "expenses",
      "id,expense_date,amount,category,description,business_domain,notes,project_id,order_id,property_id,recorded_by",
      "expense_date"
    ),
    (async () => {
      try {
        const workerPaymentRows = await scanWorkerPaymentRows(supabase);
        const workerPaymentIds = workerPaymentRows.map((row) => row.id);
        const allocations = await fetchWorkerPaymentAllocationsByPaymentIds(supabase, workerPaymentIds);
        const attendanceSessionRows = await scanAttendanceSessionRows(supabase);
        const sessionsById = new Map(
          attendanceSessionRows
            .filter((row) => row.id)
            .map((row) => [row.id, row] as const)
        );
        return { workerPaymentRows, allocations, attendanceSessionRows, sessionsById };
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          return {
            workerPaymentRows: [] as WorkerPaymentRow[],
            allocations: [] as WorkerPaymentAllocationRow[],
            attendanceSessionRows: [] as AttendanceSessionFinanceRow[],
            sessionsById: new Map<string, AttendanceSessionFinanceRow>(),
          };
        }
        throw error;
      }
    })(),
    scanProjectRows(supabase),
    scanOrderRows(supabase),
  ]);

  const paymentLinks = paymentRows.map(resolvePaymentLinks);
  const projectExpenseLinksByExpenseId = await fetchProjectExpenseLinksByExpenseIds(
    supabase,
    expenseRows.map((row) => row.id)
  );
  const workerPaymentById = new Map(
    workerPaymentsResult.workerPaymentRows
      .filter((row) => row.id)
      .map((row) => [row.id, row] as const)
  );
  const projectIds = uniqueStrings([
    ...projectRows.map((row) => row.id),
    ...paymentLinks.map((row) => row.projectId),
    ...expenseRows.map((row) => row.project_id || projectExpenseLinksByExpenseId.get(row.id) || null),
    ...workerPaymentsResult.attendanceSessionRows.map((row) => row.project_id),
  ]);
  const orderIds = uniqueStrings([
    ...orderRows.map((row) => row.id),
    ...paymentLinks.map((row) => row.orderId),
    ...expenseRows.map((row) => row.order_id),
  ]);
  const propertyIds = uniqueStrings([
    ...paymentLinks.map((row) => row.propertyId),
    ...expenseRows.map((row) => row.property_id),
    ...workerPaymentsResult.attendanceSessionRows.map((row) => row.property_id),
  ]);
  const workerUserIds = uniqueStrings([
    ...workerPaymentsResult.workerPaymentRows.map((row) => row.user_id),
    ...workerPaymentsResult.attendanceSessionRows.map((row) => row.user_id),
  ]);
  const recordedByValues = uniqueStrings([
    ...paymentRows.map((row) => row.recorded_by),
    ...expenseRows.map((row) => row.recorded_by),
    ...workerPaymentsResult.workerPaymentRows.map((row) => row.recorded_by),
    ...workerPaymentsResult.workerPaymentRows.map((row) => row.user_id),
    ...workerPaymentsResult.attendanceSessionRows.map((row) => row.user_id),
  ]);

  const [projectsById, projectFinancialsById, ordersById, orderFinancialsById, propertiesById, propertyCustomersById, recordedByNames, workerUsersById, salaryAgreementRows] =
    await Promise.all([
      fetchProjectsByIds(supabase, projectIds),
      fetchProjectFinancialsByIds(supabase, projectIds),
      fetchOrdersByIds(supabase, orderIds),
      fetchOrderFinancialsByIds(supabase, orderIds),
      fetchPropertiesByIds(supabase, propertyIds),
      fetchPropertyCustomerLinks(supabase, propertyIds),
      resolveUserDisplayNamesForValues(supabase, recordedByValues),
      fetchWorkerUsersByIds(supabase, workerUserIds),
      fetchSalaryAgreementsByUserIds(supabase, workerUserIds),
    ]);

  const salaryAgreementsByUserId = salaryAgreementRows.reduce((map, agreement) => {
    const userId = agreement.user_id?.trim();
    if (!userId) return map;
    const current = map.get(userId) ?? [];
    current.push(agreement);
    map.set(userId, current);
    return map;
  }, new Map<string, SalaryAgreementLiteRow[]>());

  const payments = paymentRows.flatMap((row) => {
    const flowMeta = buildPaymentFlowMeta(row, referenceDate);
    if (!row.id || !flowMeta) return [];

    const links = resolvePaymentLinks(row);
    const businessDomain = normalizeDomain(row.business_domain);
    const linkedProject = links.projectId ? projectsById.get(links.projectId) ?? null : null;
    const linkedOrder = links.orderId ? ordersById.get(links.orderId) ?? null : null;
    const linkedProperty = links.propertyId ? propertiesById.get(links.propertyId) ?? null : null;
    const propertyCustomers = links.propertyId
      ? propertyCustomersById.get(links.propertyId) ?? null
      : null;

    if (
      !matchesCustomerFilter({
        customerId,
        customerProjectIds: customerProjectSet,
        projectId: links.projectId,
        orderCustomerId: linkedOrder?.customer_id ?? null,
        propertyCustomerIds: propertyCustomers,
        projectCustomerId: linkedProject?.customer_id ?? null,
      })
    ) {
      return [];
    }

    const amount = Math.abs(toNumber(row.amount_total));
    const source = buildSource({
      businessDomain,
      projectId: links.projectId,
      orderId: links.orderId,
      propertyId: links.propertyId,
      projectName: linkedProject?.name?.trim() || null,
      propertyAddress: linkedProperty?.address?.trim() || null,
    });

    const description = buildPaymentDescription(row);
    const reference = row.reference_number?.trim() || null;
    const paymentMethodValue = row.payment_method?.trim() || null;

    return [
      {
        id: `payment:${row.id}`,
        type: "inflow" as const,
        amount,
        signedAmount: amount,
        businessDomain,
        domainName: getBusinessDomainLabel(businessDomain),
        flowDate: flowMeta.flowDate,
        recordedDate: flowMeta.paymentDate,
        dueDate: flowMeta.dueDate,
        stage: flowMeta.stage,
        sourceKind: source.kind,
        sourceId: source.id,
        sourceLabel: source.label,
        sourceHref: source.href,
        description,
        origin: "payment" as const,
        reference,
        paymentMethod: paymentMethodValue,
        paymentMethodLabel: paymentMethodValue ? paymentMethodLabel(paymentMethodValue) : null,
        paymentStatus: flowMeta.status,
        recordedByName:
          typeof row.recorded_by === "string" ? recordedByNames[row.recorded_by] ?? null : null,
        customerId: linkedOrder?.customer_id ?? linkedProject?.customer_id ?? null,
        searchText: [
          description,
          source.label,
          reference ?? "",
          row.notes ?? "",
          row.payment_method ?? "",
          row.payment_status ?? "",
          getBusinessDomainLabel(businessDomain),
          typeof row.recorded_by === "string" ? recordedByNames[row.recorded_by] ?? "" : "",
        ]
          .join(" ")
          .toLowerCase(),
      },
    ];
  });

  const expenses = expenseRows.flatMap((row) => {
    const flowMeta = buildExpenseFlowMeta(row, referenceDate);
    if (!row.id || !flowMeta) return [];

    const businessDomain = normalizeDomain(row.business_domain);
    const resolvedProjectId = row.project_id || projectExpenseLinksByExpenseId.get(row.id) || null;
    const linkedProject = resolvedProjectId ? projectsById.get(resolvedProjectId) ?? null : null;
    const linkedOrder = row.order_id ? ordersById.get(row.order_id) ?? null : null;
    const linkedProperty = row.property_id ? propertiesById.get(row.property_id) ?? null : null;
    const propertyCustomers = row.property_id
      ? propertyCustomersById.get(row.property_id) ?? null
      : null;

    if (
      !matchesCustomerFilter({
        customerId,
        customerProjectIds: customerProjectSet,
        projectId: resolvedProjectId,
        orderCustomerId: linkedOrder?.customer_id ?? null,
        propertyCustomerIds: propertyCustomers,
        projectCustomerId: linkedProject?.customer_id ?? null,
      })
    ) {
      return [];
    }

    const amount = Math.abs(toNumber(row.amount));
    const source = buildSource({
      businessDomain,
      projectId: resolvedProjectId,
      orderId: row.order_id,
      propertyId: row.property_id,
      projectName: linkedProject?.name?.trim() || null,
      propertyAddress: linkedProperty?.address?.trim() || null,
    });
    const description = buildExpenseDescription(row);
    const reference = row.category?.trim() || null;

    return [
      {
        id: `expense:${row.id}`,
        type: "outflow" as const,
        amount,
        signedAmount: -amount,
        businessDomain,
        domainName: getBusinessDomainLabel(businessDomain),
        flowDate: flowMeta.flowDate,
        recordedDate: flowMeta.recordedDate,
        dueDate: null,
        stage: flowMeta.stage,
        sourceKind: source.kind,
        sourceId: source.id,
        sourceLabel: source.label,
        sourceHref: source.href,
        description,
        origin: "expense" as const,
        reference,
        paymentMethod: null,
        paymentMethodLabel: null,
        paymentStatus: null,
        recordedByName:
          typeof row.recorded_by === "string" ? recordedByNames[row.recorded_by] ?? null : null,
        customerId: linkedOrder?.customer_id ?? linkedProject?.customer_id ?? null,
        searchText: [
          description,
          source.label,
          reference ?? "",
          row.notes ?? "",
          row.category ?? "",
          getBusinessDomainLabel(businessDomain),
          typeof row.recorded_by === "string" ? recordedByNames[row.recorded_by] ?? "" : "",
        ]
          .join(" ")
          .toLowerCase(),
      },
    ];
  });

  const workerPaymentEntries = workerPaymentsResult.allocations.flatMap((allocation) => {
    if (!allocation.id || !allocation.worker_payment_id) return [];
    const workerPayment = workerPaymentById.get(allocation.worker_payment_id);
    if (!workerPayment?.id) return [];

    const flowMeta = buildWorkerPaymentFlowMeta(workerPayment.payment_date, referenceDate);
    if (!flowMeta) return [];

    const session =
      allocation.source_type === "session" && allocation.attendance_session_id
        ? workerPaymentsResult.sessionsById.get(allocation.attendance_session_id) ?? null
        : null;
    const businessDomain =
      session?.business_domain ? normalizeDomain(session.business_domain) : "general_business";
    const linkedProject = session?.project_id ? projectsById.get(session.project_id) ?? null : null;
    const linkedProperty = session?.property_id ? propertiesById.get(session.property_id) ?? null : null;
    const propertyCustomers = session?.property_id
      ? propertyCustomersById.get(session.property_id) ?? null
      : null;

    if (
      !matchesCustomerFilter({
        customerId,
        customerProjectIds: customerProjectSet,
        projectId: session?.project_id ?? null,
        orderCustomerId: null,
        propertyCustomerIds: propertyCustomers,
        projectCustomerId: linkedProject?.customer_id ?? null,
      })
    ) {
      return [];
    }

    const amount = Math.abs(toNumber(allocation.amount));
    if (!(amount > 0)) return [];

    const source = buildSource({
      businessDomain,
      projectId: session?.project_id ?? null,
      orderId: null,
      propertyId: session?.property_id ?? null,
      projectName: linkedProject?.name?.trim() || null,
      propertyAddress: linkedProperty?.address?.trim() || null,
    });
    const workerName =
      (workerPayment.user_id && recordedByNames[workerPayment.user_id]) ||
      (session?.user_id && recordedByNames[session.user_id]) ||
      null;
    const description = buildWorkerPaymentDescription(workerName);
    const reference = workerPayment.reference_number?.trim() || null;
    const paymentMethodValue = workerPayment.payment_method?.trim() || null;

    return [
      {
        id: `worker-payment-allocation:${allocation.id}`,
        type: "outflow" as const,
        amount,
        signedAmount: -amount,
        businessDomain,
        domainName: getBusinessDomainLabel(businessDomain),
        flowDate: flowMeta.flowDate,
        recordedDate: flowMeta.recordedDate,
        dueDate: null,
        stage: flowMeta.stage,
        sourceKind: source.kind,
        sourceId: source.id,
        sourceLabel: source.label,
        sourceHref: source.href,
        description,
        origin: "worker_payment" as const,
        reference,
        paymentMethod: paymentMethodValue,
        paymentMethodLabel: paymentMethodValue ? paymentMethodLabel(paymentMethodValue) : null,
        paymentStatus: null,
        recordedByName:
          typeof workerPayment.recorded_by === "string"
            ? recordedByNames[workerPayment.recorded_by] ?? null
            : null,
        customerId: linkedProject?.customer_id ?? null,
        searchText: [
          description,
          source.label,
          reference ?? "",
          workerPayment.notes ?? "",
          paymentMethodValue ?? "",
          workerName ?? "",
          getBusinessDomainLabel(businessDomain),
          typeof workerPayment.recorded_by === "string"
            ? recordedByNames[workerPayment.recorded_by] ?? ""
            : "",
        ]
          .join(" ")
          .toLowerCase(),
      },
    ];
  });

  const paidWorkerAmountBySessionId = workerPaymentsResult.allocations.reduce((map, allocation) => {
    if (allocation.source_type !== "session" || !allocation.attendance_session_id) return map;
    const amount = Math.abs(toNumber(allocation.amount));
    if (!(amount > 0)) return map;
    map.set(
      allocation.attendance_session_id,
      (map.get(allocation.attendance_session_id) ?? 0) + amount
    );
    return map;
  }, new Map<string, number>());

  const rawWorkerOwedEntries = workerPaymentsResult.attendanceSessionRows.flatMap((session) => {
    if (!session.id) return [];

    const businessDomain =
      session.business_domain ? normalizeDomain(session.business_domain) : "general_business";
    const linkedProject = session.project_id ? projectsById.get(session.project_id) ?? null : null;
    const linkedProperty = session.property_id ? propertiesById.get(session.property_id) ?? null : null;
    const propertyCustomers = session.property_id
      ? propertyCustomersById.get(session.property_id) ?? null
      : null;

    if (
      !matchesCustomerFilter({
        customerId,
        customerProjectIds: customerProjectSet,
        projectId: session.project_id ?? null,
        orderCustomerId: null,
        propertyCustomerIds: propertyCustomers,
        projectCustomerId: linkedProject?.customer_id ?? null,
      })
    ) {
      return [];
    }

    const laborCost = Math.max(0, toNumber(session.labor_cost));
    const explicitPaidAmount = Math.max(0, toNumber(session.paid_amount));
    const allocatedPaidAmount = paidWorkerAmountBySessionId.get(session.id) ?? 0;
    const effectivePaidAmount = Math.max(explicitPaidAmount, allocatedPaidAmount);
    const explicitOwedAmount = Math.max(0, toNumber(session.owed_amount));
    const computedOwedAmount =
      laborCost > 0 ? Math.max(laborCost - effectivePaidAmount, 0) : 0;
    const amount =
      laborCost > 0 && effectivePaidAmount + 0.009 >= laborCost
        ? 0
        : explicitOwedAmount > 0
          ? explicitOwedAmount
          : computedOwedAmount;

    if (!(amount > 0)) return [];

    const flowMeta = buildWorkerOwedFlowMeta(session.clock_in);
    const source = buildSource({
      businessDomain,
      projectId: session.project_id ?? null,
      orderId: null,
      propertyId: session.property_id ?? null,
      projectName: linkedProject?.name?.trim() || null,
      propertyAddress: linkedProperty?.address?.trim() || null,
    });
    const workerName = session.user_id ? recordedByNames[session.user_id] ?? null : null;
    const description = buildWorkerPaymentDescription(workerName);

    return [
      {
        id: `worker-owed-session:${session.id}`,
        type: "outflow" as const,
        amount,
        signedAmount: -amount,
        businessDomain,
        domainName: getBusinessDomainLabel(businessDomain),
        flowDate: flowMeta.flowDate,
        recordedDate: flowMeta.recordedDate,
        dueDate: flowMeta.dueDate,
        stage: flowMeta.stage,
        sourceKind: source.kind,
        sourceId: source.id,
        sourceLabel: source.label,
        sourceHref: source.href,
        description,
        origin: "worker_owed" as const,
        reference: "\u05d9\u05ea\u05e8\u05d4 \u05dc\u05ea\u05e9\u05dc\u05d5\u05dd",
        paymentMethod: null,
        paymentMethodLabel: null,
        paymentStatus: normalizePaymentStatus(session.payment_status),
        recordedByName: null,
        customerId: linkedProject?.customer_id ?? null,
        searchText: [
          description,
          source.label,
          "\u05d9\u05ea\u05e8\u05d4 \u05dc\u05ea\u05e9\u05dc\u05d5\u05dd",
          workerName ?? "",
          getBusinessDomainLabel(businessDomain),
        ]
          .join(" ")
          .toLowerCase(),
      },
    ];
  });

  const aggregatedWorkerOwedMap: Map<string, FinancialEntry> = new Map();
  const workerOwedEntries: FinancialEntry[] = rawWorkerOwedEntries.flatMap((entry) => {
    const sessionId = entry.id.replace("worker-owed-session:", "");
    const session = workerPaymentsResult.sessionsById.get(sessionId) ?? null;
    const workerId = session?.user_id?.trim() ?? "";
    const worker = workerId ? workerUsersById.get(workerId) ?? null : null;
    const agreements = workerId ? salaryAgreementsByUserId.get(workerId) ?? [] : [];
    const shouldAggregate = shouldAggregateWorkerDebt({
      worker,
      agreements,
      sessionDate: session?.clock_in ?? null,
    });

    if (!shouldAggregate || !workerId) {
      return [entry];
    }

    const workerName = recordedByNames[workerId] ?? null;
    const monthKey = monthKeyFromIso(session?.clock_in ?? null);
    const monthlyFlowMeta = buildMonthlyWorkerOwedFlowMeta(session?.clock_in ?? null, referenceDate);
    const key = `worker-owed-user:${workerId}:${monthKey || "unknown"}`;
    const existing = aggregatedWorkerOwedMap.get(key);

    if (!existing) {
      aggregatedWorkerOwedMap.set(key, {
        ...entry,
        id: key,
        flowDate: monthlyFlowMeta.flowDate,
        dueDate: monthlyFlowMeta.dueDate,
        stage: monthlyFlowMeta.stage,
        sourceKind: "general",
        sourceId: null,
        sourceLabel: "\u05e9\u05db\u05e8 \u05e2\u05d5\u05d1\u05d3\u05d9\u05dd",
        sourceHref: null,
        description: monthKey
          ? `${buildWorkerPaymentDescription(workerName)} • ${monthKey}`
          : buildWorkerPaymentDescription(workerName),
        searchText: [
          monthKey
            ? `${buildWorkerPaymentDescription(workerName)} ${monthKey}`
            : buildWorkerPaymentDescription(workerName),
          "\u05d9\u05ea\u05e8\u05d4 \u05dc\u05ea\u05e9\u05dc\u05d5\u05dd",
          "\u05e9\u05db\u05e8 \u05e2\u05d5\u05d1\u05d3\u05d9\u05dd",
          workerName ?? "",
          entry.domainName,
        ]
          .join(" ")
          .toLowerCase(),
      });
      return [];
    }

    existing.amount += entry.amount;
    existing.signedAmount -= entry.amount;
    existing.recordedDate =
      existing.recordedDate && entry.recordedDate
        ? entry.recordedDate < existing.recordedDate
          ? entry.recordedDate
          : existing.recordedDate
        : existing.recordedDate ?? entry.recordedDate;
    return [];
  });
  workerOwedEntries.push(...aggregatedWorkerOwedMap.values());

  const paidByProjectId = paymentRows.reduce((map, row) => {
    const links = resolvePaymentLinks(row);
    if (!links.projectId) return map;
    map.set(links.projectId, (map.get(links.projectId) ?? 0) + Math.abs(toNumber(row.amount_total)));
    return map;
  }, new Map<string, number>());
  const paidByOrderId = paymentRows.reduce((map, row) => {
    const links = resolvePaymentLinks(row);
    if (!links.orderId) return map;
    map.set(links.orderId, (map.get(links.orderId) ?? 0) + Math.abs(toNumber(row.amount_total)));
    return map;
  }, new Map<string, number>());

  const projectReceivableEntries = projectRows.flatMap((project) => {
    if (!project.id) return [];
    if (isExcludedProjectStatus(project.status)) return [];

    const linkedProject = projectsById.get(project.id) ?? project;
    if (
      !matchesCustomerFilter({
        customerId,
        customerProjectIds: customerProjectSet,
        projectId: project.id,
        orderCustomerId: null,
        propertyCustomerIds: null,
        projectCustomerId: linkedProject.customer_id ?? null,
      })
    ) {
      return [];
    }

    const financialRow = projectFinancialsById.get(project.id) ?? null;
    const actualPrice = toNumber(linkedProject.actual_price);
    const agreedBasePrice = toNumber(linkedProject.agreed_base_price);
    const expensesBilled = Math.max(0, toNumber(financialRow?.expenses_billed));
    const fallbackTotal =
      (actualPrice > 0 ? actualPrice : agreedBasePrice > 0 ? agreedBasePrice : 0) + expensesBilled;
    const customerTotalPrice = Math.max(toNumber(financialRow?.customer_total_price), fallbackTotal);
    const paidAmount = paidByProjectId.get(project.id) ?? 0;
    const amount = Math.max(customerTotalPrice - paidAmount, 0);

    if (!(amount > 0)) return [];

    const isOpenDebt = isClosedProjectStatus(linkedProject.status);
    const flowMeta = isOpenDebt
      ? buildReceivableFlowMeta(linkedProject.end_date ?? linkedProject.created_at, referenceDate)
      : buildPlannedReceivableFlowMeta(
          [linkedProject.end_date, linkedProject.start_date, linkedProject.created_at],
          referenceDate
        );
    const source = buildSource({
      businessDomain: "logistics_projects",
      projectId: project.id,
      orderId: null,
      propertyId: null,
      projectName: linkedProject.name?.trim() || null,
      propertyAddress: null,
    });

    return [
      {
        id: `project-receivable:${project.id}`,
        type: "inflow" as const,
        amount,
        signedAmount: amount,
        businessDomain: "logistics_projects" as const,
        domainName: getBusinessDomainLabel("logistics_projects"),
        flowDate: flowMeta.flowDate,
        recordedDate: flowMeta.recordedDate,
        dueDate: flowMeta.dueDate,
        stage: flowMeta.stage,
        sourceKind: source.kind,
        sourceId: source.id,
        sourceLabel: source.label,
        sourceHref: source.href,
        description: isOpenDebt
          ? "\u05d9\u05ea\u05e8\u05ea \u05dc\u05e7\u05d5\u05d7 \u05dc\u05ea\u05e9\u05dc\u05d5\u05dd"
          : "\u05d4\u05db\u05e0\u05e1\u05d4 \u05de\u05ea\u05d5\u05db\u05e0\u05e0\u05ea \u05de\u05dc\u05e7\u05d5\u05d7",
        origin: "project_receivable" as const,
        reference: null,
        paymentMethod: null,
        paymentMethodLabel: null,
        paymentStatus: isOpenDebt ? "pending" : "scheduled",
        recordedByName: null,
        customerId: linkedProject.customer_id ?? null,
        searchText: [
          isOpenDebt
            ? "\u05d9\u05ea\u05e8\u05ea \u05dc\u05e7\u05d5\u05d7 \u05dc\u05ea\u05e9\u05dc\u05d5\u05dd"
            : "\u05d4\u05db\u05e0\u05e1\u05d4 \u05de\u05ea\u05d5\u05db\u05e0\u05e0\u05ea \u05de\u05dc\u05e7\u05d5\u05d7",
          source.label,
          getBusinessDomainLabel("logistics_projects"),
        ]
          .join(" ")
          .toLowerCase(),
      },
    ];
  });

  const orderReceivableEntries = orderRows.flatMap((order) => {
    if (!order.id) return [];
    if (isExcludedOrderStatus(order.status)) return [];

    const linkedOrder = ordersById.get(order.id) ?? order;
    if (
      !matchesCustomerFilter({
        customerId,
        customerProjectIds: customerProjectSet,
        projectId: null,
        orderCustomerId: linkedOrder.customer_id ?? null,
        propertyCustomerIds: null,
        projectCustomerId: null,
      })
    ) {
      return [];
    }

    const financialRow = orderFinancialsById.get(order.id) ?? null;
    const totalAmount = Math.max(
      0,
      toNumber(financialRow?.total_amount) || toNumber(linkedOrder.total_amount)
    );
    const totalPaid = Math.max(
      0,
      toNumber(financialRow?.total_paid),
      paidByOrderId.get(order.id) ?? 0
    );
    const normalizedOrderPaymentStatus = normalizePaymentStatus(
      financialRow?.payment_status ?? linkedOrder.payment_status
    );
    const hasExplicitRemaining =
      financialRow?.remaining_balance !== null && financialRow?.remaining_balance !== undefined;
    const explicitRemainingBalance = Math.max(0, toNumber(financialRow?.remaining_balance));
    const derivedRemainingBalance = totalAmount > 0 ? Math.max(totalAmount - totalPaid, 0) : 0;
    const remainingBalance =
      normalizedOrderPaymentStatus === "paid" || normalizedOrderPaymentStatus === "cleared"
        ? 0
        : hasExplicitRemaining
          ? explicitRemainingBalance
          : derivedRemainingBalance;

    if (!(remainingBalance > 0)) return [];

    const isOpenDebt = isClosedOrderStatus(linkedOrder.status);
    const flowMeta = isOpenDebt
      ? buildReceivableFlowMeta(linkedOrder.order_date, referenceDate)
      : buildPlannedReceivableFlowMeta([linkedOrder.order_date], referenceDate);
    const source = buildSource({
      businessDomain: "sales",
      projectId: null,
      orderId: order.id,
      propertyId: null,
      projectName: null,
      propertyAddress: null,
    });

    return [
      {
        id: `order-receivable:${order.id}`,
        type: "inflow" as const,
        amount: remainingBalance,
        signedAmount: remainingBalance,
        businessDomain: "sales" as const,
        domainName: getBusinessDomainLabel("sales"),
        flowDate: flowMeta.flowDate,
        recordedDate: flowMeta.recordedDate,
        dueDate: flowMeta.dueDate,
        stage: flowMeta.stage,
        sourceKind: source.kind,
        sourceId: source.id,
        sourceLabel: source.label,
        sourceHref: source.href,
        description: isOpenDebt
          ? "\u05d9\u05ea\u05e8\u05ea \u05dc\u05e7\u05d5\u05d7 \u05dc\u05ea\u05e9\u05dc\u05d5\u05dd"
          : "\u05d4\u05db\u05e0\u05e1\u05d4 \u05de\u05ea\u05d5\u05db\u05e0\u05e0\u05ea \u05de\u05dc\u05e7\u05d5\u05d7",
        origin: "order_receivable" as const,
        reference: null,
        paymentMethod: null,
        paymentMethodLabel: null,
        paymentStatus: isOpenDebt
          ? normalizedOrderPaymentStatus ?? "pending"
          : "scheduled",
        recordedByName: null,
        customerId: linkedOrder.customer_id ?? null,
        searchText: [
          isOpenDebt
            ? "\u05d9\u05ea\u05e8\u05ea \u05dc\u05e7\u05d5\u05d7 \u05dc\u05ea\u05e9\u05dc\u05d5\u05dd"
            : "\u05d4\u05db\u05e0\u05e1\u05d4 \u05de\u05ea\u05d5\u05db\u05e0\u05e0\u05ea \u05de\u05dc\u05e7\u05d5\u05d7",
          source.label,
          getBusinessDomainLabel("sales"),
        ]
          .join(" ")
          .toLowerCase(),
      },
    ];
  });

  const entries = sortEntries([
    ...payments,
    ...expenses,
    ...workerPaymentEntries,
    ...workerOwedEntries,
    ...projectReceivableEntries,
    ...orderReceivableEntries,
  ]);
  const domainOptions = Array.from(
    new Set(
      entries
        .map((entry) => entry.businessDomain)
        .filter((value): value is ExpenseBusinessDomain => Boolean(value))
    )
  ).sort((left, right) =>
    getBusinessDomainLabel(left).localeCompare(getBusinessDomainLabel(right), "he")
  );
  const sourceKind = domainToSourceKind(domain);
  const sourceOptions = sourceKind
    ? Array.from(
        entries.reduce((map, entry) => {
          if (entry.sourceKind !== sourceKind || !entry.sourceId) return map;
          if (domain && entry.businessDomain !== domain) return map;
          map.set(entry.sourceId, {
            id: entry.sourceId,
            label: entry.sourceLabel,
          });
          return map;
        }, new Map<string, { id: string; label: string }>())
      ).map(([, value]) => value)
    : [];

  sourceOptions.sort((left, right) => left.label.localeCompare(right.label, "he"));

  const filteredEntries = entries.filter((entry) =>
    matchesEntryFilters(entry, {
      from,
      to,
      domain,
      sourceId,
      type,
      stage,
      query,
      referenceDate,
    })
  );
  const actualEntries = filteredEntries.filter((entry) => !isFutureEntry(entry, referenceDate));
  const futureEntries = filteredEntries.filter((entry) => isFutureEntry(entry, referenceDate));
  const forecastEndIso = to || addDaysToIso(referenceDate, 30);
  const forecastEntries = filteredEntries.filter((entry) => entry.flowDate <= forecastEndIso);
  const openReceivableEntries = filteredEntries.filter(
    (entry) =>
      entry.type === "inflow" &&
      entry.stage === "pending" &&
      (entry.origin === "project_receivable" || entry.origin === "order_receivable")
  );
  const plannedReceivableEntries = filteredEntries.filter(
    (entry) =>
      entry.type === "inflow" &&
      ((entry.origin === "payment" && entry.stage !== "posted") ||
        ((entry.origin === "project_receivable" || entry.origin === "order_receivable") &&
          entry.stage === "scheduled"))
  );
  const openLiabilityEntries = filteredEntries.filter(
    (entry) => entry.type === "outflow" && entry.stage === "pending"
  );
  const scheduledLiabilityEntries = filteredEntries.filter(
    (entry) => entry.type === "outflow" && entry.stage === "scheduled"
  );
  const sourceCount = new Set(
    filteredEntries.map((entry) => entry.sourceId).filter((value): value is string => Boolean(value))
  ).size;
  const ledgerPagination = paginateEntries(filteredEntries, ledgerPage, LEDGER_PAGE_SIZE);
  const upcomingSortedEntries = [...futureEntries].sort(
    (left, right) =>
      left.flowDate.localeCompare(right.flowDate) ||
      (left.recordedDate ?? "").localeCompare(right.recordedDate ?? "") ||
      left.id.localeCompare(right.id)
  );
  const upcomingPagination = paginateEntries(
    upcomingSortedEntries,
    upcomingPage,
    UPCOMING_PAGE_SIZE
  );

  return {
    todayIso: referenceDate,
    actualSummary: summarizeEntries(actualEntries),
    futureSummary: summarizeEntries(futureEntries),
    totalSummary: summarizeEntries(filteredEntries),
    forecastSummary: summarizeEntries(forecastEntries),
    forecastEndIso,
    openReceivablesSummary: summarizeEntries(openReceivableEntries),
    plannedReceivablesSummary: summarizeEntries(plannedReceivableEntries),
    openLiabilitiesSummary: summarizeEntries(openLiabilityEntries),
    scheduledLiabilitiesSummary: summarizeEntries(scheduledLiabilityEntries),
    domainGroups: buildDomainGroups(filteredEntries, referenceDate),
    domainOptions,
    sourceKind,
    sourceOptions,
    sourceCount,
    ledgerEntries: ledgerPagination.entries,
    ledgerTotalCount: ledgerPagination.totalCount,
    ledgerPage: ledgerPagination.page,
    ledgerTotalPages: ledgerPagination.totalPages,
    upcomingEntries: upcomingPagination.entries,
    upcomingTotalCount: upcomingPagination.totalCount,
    upcomingPage: upcomingPagination.page,
    upcomingTotalPages: upcomingPagination.totalPages,
  };
}
