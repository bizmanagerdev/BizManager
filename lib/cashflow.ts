import type { SupabaseClient } from "@supabase/supabase-js";

export type CashFlowType = "inflow" | "outflow";

export type CashFlowFilters = {
  from?: string | null;
  to?: string | null;
  customerId?: string | null;
  projectId?: string | null;
  type?: CashFlowType | "all" | null;
  page?: number;
  pageSize?: number;
};

type PaymentRow = {
  id: string;
  target_type: string | null;
  target_id: string | null;
  payment_date: string | null;
  amount_total: number | string | null;
  payment_method: string | null;
  reference_number: string | null;
  notes: string | null;
};

type ExpenseRow = {
  id: string;
  expense_date: string | null;
  amount: number | string | null;
  category: string | null;
  description: string | null;
  notes: string | null;
};

type OrderRow = {
  id: string;
  customer_id: string | null;
};

type ProjectRow = {
  id: string;
  name: string | null;
  customer_id: string | null;
};

type ProjectExpenseLinkRow = {
  expense_id: string | null;
  project_id: string | null;
};

export type CashFlowTransaction = {
  id: string;
  date: string;
  amount: number;
  signedAmount: number;
  type: CashFlowType;
  project_id: string | null;
  project_name: string | null;
  description: string | null;
  reference: string | null;
};

export type CashFlowSummary = {
  totalInflow: number;
  totalOutflow: number;
  netCashFlow: number;
};

export type CashFlowTrendPoint = {
  period: string;
  inflow: number;
  outflow: number;
  net: number;
};

export type CashFlowCumulativePoint = CashFlowTrendPoint & {
  balance: number;
};

export type CashFlowProjectBreakdownPoint = {
  projectId: string | null;
  projectName: string;
  inflow: number;
  outflow: number;
  net: number;
};

export type ProjectOption = {
  id: string;
  name: string;
};

export type CashFlowTransactionsResult = {
  rows: CashFlowTransaction[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
};

export type CashFlowPageData = {
  summary: CashFlowSummary;
  transactions: CashFlowTransactionsResult;
  trend: CashFlowTrendPoint[];
  cumulativeTrend: CashFlowCumulativePoint[];
  projectBreakdown: CashFlowProjectBreakdownPoint[];
};

type ProjectOptionRow = {
  id: string;
  name: string | null;
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const SCAN_CHUNK_SIZE = 500;
const ID_CHUNK_SIZE = 200;

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

function normalizeDateInput(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function normalizeProjectId(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeCustomerId(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeType(value: string | null | undefined) {
  return value === "inflow" || value === "outflow" ? value : "all";
}

function normalizePage(value: number | string | null | undefined) {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function normalizePageSize(value: number | string | null | undefined) {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(parsed), MAX_PAGE_SIZE);
}

function monthPeriod(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dayPeriod(date: Date) {
  return date.toISOString().slice(0, 10);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function chunkStrings(values: string[], chunkSize: number) {
  const chunks: string[][] = [];
  for (let start = 0; start < values.length; start += chunkSize) {
    chunks.push(values.slice(start, start + chunkSize));
  }
  return chunks;
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

async function scanRows<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  table: string,
  selectColumns: string,
  dateColumn: string,
  filters: CashFlowFilters
) {
  const rows: T[] = [];
  const fromDate = normalizeDateInput(filters.from);
  const toDate = normalizeDateInput(filters.to);

  for (let rangeStart = 0; ; rangeStart += SCAN_CHUNK_SIZE) {
    const rangeEnd = rangeStart + SCAN_CHUNK_SIZE - 1;
    let query = supabase.from(table).select(selectColumns);

    if (fromDate) query = query.gte(dateColumn, fromDate);
    if (toDate) query = query.lte(dateColumn, toDate);

    const { data, error } = await query
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

async function fetchProjectsByIds(supabase: SupabaseClient, ids: string[]) {
  const map = new Map<string, ProjectRow>();
  const chunks = chunkStrings(uniqueStrings(ids), ID_CHUNK_SIZE);

  for (const chunk of chunks) {
    const { data, error } = await supabase
      .from("projects")
      .select("id,name,customer_id")
      .in("id", chunk);

    if (error) throw error;

    ((data ?? []) as ProjectRow[]).forEach((row) => {
      if (row.id) map.set(row.id, row);
    });
  }

  return map;
}

async function fetchOrdersByIds(supabase: SupabaseClient, ids: string[]) {
  const map = new Map<string, OrderRow>();
  const chunks = chunkStrings(uniqueStrings(ids), ID_CHUNK_SIZE);

  for (const chunk of chunks) {
    const { data, error } = await supabase
      .from("orders")
      .select("id,customer_id")
      .in("id", chunk);

    if (error) throw error;

    ((data ?? []) as OrderRow[]).forEach((row) => {
      if (row.id) map.set(row.id, row);
    });
  }

  return map;
}

async function fetchExpenseProjectLinks(supabase: SupabaseClient, expenseIds: string[]) {
  const map = new Map<string, string>();
  const chunks = chunkStrings(uniqueStrings(expenseIds), ID_CHUNK_SIZE);

  for (const chunk of chunks) {
    const { data, error } = await supabase
      .from("project_expenses")
      .select("expense_id,project_id")
      .in("expense_id", chunk);

    if (error) throw error;

    ((data ?? []) as ProjectExpenseLinkRow[]).forEach((row) => {
      if (row.expense_id && row.project_id && !map.has(row.expense_id)) {
        map.set(row.expense_id, row.project_id);
      }
    });
  }

  return map;
}

function matchesPaymentFilters(
  row: PaymentRow,
  filters: CashFlowFilters,
  projectCustomerId: string | null,
  orderCustomerId: string | null,
  customerProjectIds: Set<string>
) {
  const projectId = normalizeProjectId(filters.projectId);
  const customerId = normalizeCustomerId(filters.customerId);
  const targetType = row.target_type?.trim() ?? "";
  const targetId = normalizeProjectId(row.target_id);

  if (projectId) {
    if (targetType !== "project") return false;
    if (targetId !== projectId) return false;
  }

  if (!customerId) return true;

  if (targetType === "project" && targetId) {
    return projectCustomerId === customerId || customerProjectIds.has(targetId);
  }

  if (targetType === "order") {
    return orderCustomerId === customerId;
  }

  return false;
}

function matchesExpenseFilters(
  filters: CashFlowFilters,
  linkedProjectId: string | null,
  projectCustomerId: string | null,
  customerProjectIds: Set<string>
) {
  const projectId = normalizeProjectId(filters.projectId);
  const customerId = normalizeCustomerId(filters.customerId);

  if (projectId && linkedProjectId !== projectId) return false;
  if (!customerId) return true;
  if (!linkedProjectId) return false;

  return projectCustomerId === customerId || customerProjectIds.has(linkedProjectId);
}

function buildPaymentSourceLabel(row: PaymentRow, projectName: string | null) {
  const targetType = row.target_type?.trim() ?? "";

  if (targetType === "project" && projectName) return projectName;
  if (targetType === "order") return "Sales order";
  if (projectName) return projectName;
  return "Other income";
}

function buildExpenseSourceLabel(projectName: string | null) {
  return projectName || "General expense";
}

function buildPaymentDescription(row: PaymentRow) {
  const notes = row.notes?.trim();
  if (notes) return notes;

  const referenceNumber = row.reference_number?.trim();
  if (referenceNumber) return referenceNumber;

  const paymentMethod = row.payment_method?.trim();
  if (paymentMethod) return paymentMethod;

  return "Payment";
}

function buildPaymentReference(row: PaymentRow) {
  const referenceNumber = row.reference_number?.trim();
  if (referenceNumber) return referenceNumber;

  const targetId = row.target_id?.trim();
  if (targetId) return targetId;

  return row.id;
}

function buildExpenseDescription(row: ExpenseRow) {
  const description = row.description?.trim();
  if (description) return description;

  const notes = row.notes?.trim();
  if (notes) return notes;

  const category = row.category?.trim();
  if (category) return category;

  return "Expense";
}

function buildExpenseReference(row: ExpenseRow) {
  const category = row.category?.trim();
  if (category) return category;

  return row.id;
}

function sortTransactions(rows: CashFlowTransaction[]) {
  return [...rows].sort((left, right) => {
    const dateCompare = right.date.localeCompare(left.date);
    if (dateCompare !== 0) return dateCompare;
    return right.id.localeCompare(left.id);
  });
}

async function loadCashFlowEntries(
  supabase: SupabaseClient,
  filters: CashFlowFilters
): Promise<CashFlowTransaction[]> {
  const typeFilter = normalizeType(filters.type);
  const customerProjectIds = await resolveCustomerProjectIds(
    supabase,
    normalizeCustomerId(filters.customerId)
  );
  const customerProjectSet = new Set(customerProjectIds);

  const [paymentRows, expenseRows] = await Promise.all([
    typeFilter === "outflow"
      ? Promise.resolve([] as PaymentRow[])
      : scanRows<PaymentRow>(
          supabase,
          "payments",
          "id,target_type,target_id,payment_date,amount_total,payment_method,reference_number,notes",
          "payment_date",
          filters
        ),
    typeFilter === "inflow"
      ? Promise.resolve([] as ExpenseRow[])
      : scanRows<ExpenseRow>(
          supabase,
          "expenses",
          "id,expense_date,amount,category,description,notes",
          "expense_date",
          filters
        ),
  ]);

  const paymentProjectIds = uniqueStrings(
    paymentRows
      .filter((row) => (row.target_type?.trim() ?? "") === "project")
      .map((row) => row.target_id)
  );
  const paymentOrderIds = uniqueStrings(
    paymentRows
      .filter((row) => (row.target_type?.trim() ?? "") === "order")
      .map((row) => row.target_id)
  );
  const expenseIds = uniqueStrings(expenseRows.map((row) => row.id));
  const expenseProjectLinks = await fetchExpenseProjectLinks(supabase, expenseIds);
  const expenseProjectIds = uniqueStrings(expenseIds.map((expenseId) => expenseProjectLinks.get(expenseId) ?? null));

  const [projectsById, ordersById] = await Promise.all([
    fetchProjectsByIds(supabase, [...paymentProjectIds, ...expenseProjectIds]),
    fetchOrdersByIds(supabase, paymentOrderIds),
  ]);

  const paymentEntries = paymentRows.flatMap((row) => {
    if (!row.id || !row.payment_date) return [];

    const targetType = row.target_type?.trim() ?? "";
    const targetId = row.target_id?.trim() ?? null;
    const linkedProject =
      targetType === "project" && targetId ? projectsById.get(targetId) ?? null : null;
    const linkedOrder =
      targetType === "order" && targetId ? ordersById.get(targetId) ?? null : null;

    if (
      !matchesPaymentFilters(
        row,
        filters,
        linkedProject?.customer_id ?? null,
        linkedOrder?.customer_id ?? null,
        customerProjectSet
      )
    ) {
      return [];
    }

    const amount = Math.abs(toNumber(row.amount_total));

    return [
      {
        id: `payment:${row.id}`,
        date: row.payment_date,
        amount,
        signedAmount: amount,
        type: "inflow" as const,
        project_id: linkedProject?.id ?? null,
        project_name: buildPaymentSourceLabel(row, linkedProject?.name?.trim() || null),
        description: buildPaymentDescription(row),
        reference: buildPaymentReference(row),
      },
    ];
  });

  const expenseEntries = expenseRows.flatMap((row) => {
    if (!row.id || !row.expense_date) return [];

    const linkedProjectId = expenseProjectLinks.get(row.id) ?? null;
    const linkedProject = linkedProjectId ? projectsById.get(linkedProjectId) ?? null : null;

    if (
      !matchesExpenseFilters(
        filters,
        linkedProjectId,
        linkedProject?.customer_id ?? null,
        customerProjectSet
      )
    ) {
      return [];
    }

    const amount = Math.abs(toNumber(row.amount));

    return [
      {
        id: `expense:${row.id}`,
        date: row.expense_date,
        amount,
        signedAmount: -amount,
        type: "outflow" as const,
        project_id: linkedProjectId,
        project_name: buildExpenseSourceLabel(linkedProject?.name?.trim() || null),
        description: buildExpenseDescription(row),
        reference: buildExpenseReference(row),
      },
    ];
  });

  return sortTransactions([...paymentEntries, ...expenseEntries]);
}

function buildSummary(rows: CashFlowTransaction[]): CashFlowSummary {
  let totalInflow = 0;
  let totalOutflow = 0;

  rows.forEach((row) => {
    if (row.type === "inflow") totalInflow += row.amount;
    if (row.type === "outflow") totalOutflow += row.amount;
  });

  return {
    totalInflow,
    totalOutflow,
    netCashFlow: totalInflow - totalOutflow,
  };
}

function buildTrend(rows: CashFlowTransaction[], filters: CashFlowFilters): CashFlowTrendPoint[] {
  const from = normalizeDateInput(filters.from);
  const to = normalizeDateInput(filters.to);
  const useDailyGrouping =
    from && to
      ? Math.abs(new Date(to).getTime() - new Date(from).getTime()) / 86400000 <= 90
      : false;

  const grouped = new Map<string, CashFlowTrendPoint>();

  rows.forEach((row) => {
    const date = new Date(row.date);
    if (Number.isNaN(date.getTime())) return;

    const period = useDailyGrouping ? dayPeriod(date) : monthPeriod(date);
    const current = grouped.get(period) ?? {
      period,
      inflow: 0,
      outflow: 0,
      net: 0,
    };

    if (row.type === "inflow") current.inflow += row.amount;
    if (row.type === "outflow") current.outflow += row.amount;
    current.net = current.inflow - current.outflow;

    grouped.set(period, current);
  });

  return [...grouped.values()].sort((left, right) => left.period.localeCompare(right.period));
}

function buildCumulativeTrend(rows: CashFlowTrendPoint[]): CashFlowCumulativePoint[] {
  let balance = 0;

  return rows.map((row) => {
    balance += row.net;
    return {
      ...row,
      balance,
    };
  });
}

function buildProjectBreakdown(rows: CashFlowTransaction[]): CashFlowProjectBreakdownPoint[] {
  const grouped = new Map<string, CashFlowProjectBreakdownPoint>();

  rows.forEach((row) => {
    const key = row.project_id ?? row.project_name ?? "__unassigned__";
    const current = grouped.get(key) ?? {
      projectId: row.project_id,
      projectName: row.project_name?.trim() || "Unassigned",
      inflow: 0,
      outflow: 0,
      net: 0,
    };

    if (row.type === "inflow") current.inflow += row.amount;
    if (row.type === "outflow") current.outflow += row.amount;
    current.net = current.inflow - current.outflow;

    grouped.set(key, current);
  });

  return [...grouped.values()]
    .sort(
      (left, right) =>
        Math.abs(right.net) - Math.abs(left.net) ||
        right.inflow + right.outflow - (left.inflow + left.outflow)
    )
    .slice(0, 8);
}

function buildTransactionsResult(
  rows: CashFlowTransaction[],
  filters: CashFlowFilters
): CashFlowTransactionsResult {
  const page = normalizePage(filters.page);
  const pageSize = normalizePageSize(filters.pageSize);
  const from = (page - 1) * pageSize;
  const to = page * pageSize;

  return {
    rows: rows.slice(from, to),
    totalCount: rows.length,
    page,
    pageSize,
    hasNextPage: to < rows.length,
  };
}

export async function getCashFlowPageData(
  supabase: SupabaseClient,
  filters: CashFlowFilters
): Promise<CashFlowPageData> {
  const rows = await loadCashFlowEntries(supabase, filters);
  const trend = buildTrend(rows, filters);

  return {
    summary: buildSummary(rows),
    transactions: buildTransactionsResult(rows, filters),
    trend,
    cumulativeTrend: buildCumulativeTrend(trend),
    projectBreakdown: buildProjectBreakdown(rows),
  };
}

export async function getCashFlowSummary(
  supabase: SupabaseClient,
  filters: CashFlowFilters
): Promise<CashFlowSummary> {
  return (await getCashFlowPageData(supabase, filters)).summary;
}

export async function getCashFlowTransactions(
  supabase: SupabaseClient,
  filters: CashFlowFilters
): Promise<CashFlowTransactionsResult> {
  return (await getCashFlowPageData(supabase, filters)).transactions;
}

export async function getCashFlowTrend(
  supabase: SupabaseClient,
  filters: CashFlowFilters
): Promise<CashFlowTrendPoint[]> {
  return (await getCashFlowPageData(supabase, filters)).trend;
}

export async function getCashFlowCumulativeTrend(
  supabase: SupabaseClient,
  filters: CashFlowFilters
): Promise<CashFlowCumulativePoint[]> {
  return (await getCashFlowPageData(supabase, filters)).cumulativeTrend;
}

export async function getCashFlowProjectBreakdown(
  supabase: SupabaseClient,
  filters: CashFlowFilters
): Promise<CashFlowProjectBreakdownPoint[]> {
  return (await getCashFlowPageData(supabase, filters)).projectBreakdown;
}

export async function getProjectOptions(
  supabase: SupabaseClient
): Promise<ProjectOption[]> {
  const { data, error } = await supabase
    .from("project_dashboard_view")
    .select("id,name")
    .order("name", { ascending: true })
    .range(0, 49);

  if (error) throw error;

  return ((data ?? []) as ProjectOptionRow[])
    .filter((row) => row.id)
    .map((row) => ({
      id: row.id,
      name: row.name?.trim() || "Project",
    }));
}
