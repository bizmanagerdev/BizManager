import type { SupabaseClient } from "@supabase/supabase-js";
import { getDerivedPaymentProjectId } from "@/lib/orders/globalProject";

/**
 * Schema decision summary
 * - source for inflow: `financial_payments_view`
 * - source for outflow: `financial_expenses_view`
 * - source for unified list: normalized union built in this module because `cash_flow_view`
 *   does not currently expose a confirmed normalized shape for date/project/amount/type/reference
 * - date field used: `payment_date` for inflow, `expense_date` for outflow
 * - amount sign conventions used: source amounts are treated as positive values; outflow is
 *   negated internally for net/trend math and displayed as an absolute value in the UI
 */

export type CashFlowType = "inflow" | "outflow";

export type CashFlowFilters = {
  from?: string | null;
  to?: string | null;
  projectId?: string | null;
  type?: CashFlowType | "all" | null;
  page?: number;
  pageSize?: number;
};

type PaymentRow = {
  id: string;
  payment_date: string;
  amount_total: number | string;
  payment_method: string | null;
  target_type: string | null;
  target_id: string | null;
  customer_id: string | null;
  order_id: string | null;
};

type ExpenseRow = {
  expense_id: string;
  expense_date: string;
  amount: number | string;
  category: string | null;
  description: string | null;
  project_id: string | null;
  project_name: string | null;
};

type ProjectOptionRow = {
  id: string;
  name: string | null;
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
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return Math.min(Math.floor(parsed), 100);
}

function sortByDateDesc<T extends { date: string }>(rows: T[]) {
  return [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function clampToEndOfDay(date: string) {
  return `${date}T23:59:59.999`;
}

function monthPeriod(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dayPeriod(date: Date) {
  return date.toISOString().slice(0, 10);
}

function labelForPayment(row: PaymentRow) {
  const parts = [
    row.payment_method?.trim() || null,
    row.order_id ? `הזמנה ${row.order_id.slice(0, 8)}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" - ") : "תשלום שהתקבל";
}

function labelForExpense(row: ExpenseRow) {
  const parts = [row.category?.trim() || null, row.description?.trim() || null].filter(Boolean);
  return parts.length > 0 ? parts.join(" - ") : "הוצאה";
}

async function getProjectMap(supabase: SupabaseClient, projectIds?: string[]) {
  let query = supabase.from("project_dashboard_view").select("id,name").limit(500);

  if (projectIds && projectIds.length > 0) {
    query = query.in("id", projectIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  return new Map(
    ((data ?? []) as ProjectOptionRow[])
      .filter((row) => row.id)
      .map((row) => [row.id, row.name?.trim() || "פרויקט"])
  );
}

async function getPaymentRows(supabase: SupabaseClient, filters: CashFlowFilters) {
  if (normalizeType(filters.type) === "outflow") {
    return [] as PaymentRow[];
  }

  let query = supabase
    .from("financial_payments_view")
    .select("id,payment_date,amount_total,payment_method,target_type,target_id,customer_id,order_id")
    .order("payment_date", { ascending: false })
    .limit(5000);

  const from = normalizeDateInput(filters.from);
  const to = normalizeDateInput(filters.to);

  if (from) query = query.gte("payment_date", from);
  if (to) query = query.lte("payment_date", clampToEndOfDay(to));

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as PaymentRow[];
  const projectId = normalizeProjectId(filters.projectId);

  if (!projectId) return rows;

  return rows.filter(
    (row) =>
      getDerivedPaymentProjectId({
        targetType: row.target_type,
        targetId: row.target_id,
      }) === projectId
  );
}

async function getExpenseRows(supabase: SupabaseClient, filters: CashFlowFilters) {
  if (normalizeType(filters.type) === "inflow") {
    return [] as ExpenseRow[];
  }

  let query = supabase
    .from("financial_expenses_view")
    .select("expense_id,expense_date,amount,category,description,project_id,project_name")
    .order("expense_date", { ascending: false })
    .limit(5000);

  const from = normalizeDateInput(filters.from);
  const to = normalizeDateInput(filters.to);
  const projectId = normalizeProjectId(filters.projectId);

  if (from) query = query.gte("expense_date", from);
  if (to) query = query.lte("expense_date", clampToEndOfDay(to));
  if (projectId) query = query.eq("project_id", projectId);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []) as ExpenseRow[];
}

async function getUnifiedTransactions(supabase: SupabaseClient, filters: CashFlowFilters) {
  const [paymentRows, expenseRows] = await Promise.all([
    getPaymentRows(supabase, filters),
    getExpenseRows(supabase, filters),
  ]);

  const paymentProjectIds = paymentRows
    .map((row) =>
      getDerivedPaymentProjectId({
        targetType: row.target_type,
        targetId: row.target_id,
      })
    )
    .filter((value): value is string => Boolean(value));

  const projectMap = await getProjectMap(supabase, Array.from(new Set(paymentProjectIds)));

  const inflowRows: CashFlowTransaction[] = paymentRows.map((row) => {
    const projectId = getDerivedPaymentProjectId({
      targetType: row.target_type,
      targetId: row.target_id,
    });

    return {
      id: `payment:${row.id}`,
      date: row.payment_date,
      amount: toNumber(row.amount_total),
      signedAmount: toNumber(row.amount_total),
      type: "inflow",
      project_id: projectId,
      project_name:
        projectId && projectMap.has(projectId) ? projectMap.get(projectId) ?? "פרויקט" : null,
      description: labelForPayment(row),
      reference: row.order_id ?? row.customer_id ?? row.target_id ?? null,
    };
  });

  const outflowRows: CashFlowTransaction[] = expenseRows.map((row) => ({
    id: `expense:${row.expense_id}`,
    date: row.expense_date,
    amount: toNumber(row.amount),
    signedAmount: -Math.abs(toNumber(row.amount)),
    type: "outflow",
    project_id: row.project_id,
    project_name: row.project_name?.trim() || null,
    description: labelForExpense(row),
    reference: row.expense_id,
  }));

  return sortByDateDesc([...inflowRows, ...outflowRows]);
}

export async function getCashFlowSummary(
  supabase: SupabaseClient,
  filters: CashFlowFilters
): Promise<CashFlowSummary> {
  const rows = await getUnifiedTransactions(supabase, filters);

  const totalInflow = rows
    .filter((row) => row.type === "inflow")
    .reduce((sum, row) => sum + row.amount, 0);
  const totalOutflow = rows
    .filter((row) => row.type === "outflow")
    .reduce((sum, row) => sum + row.amount, 0);

  return {
    totalInflow,
    totalOutflow,
    netCashFlow: totalInflow - totalOutflow,
  };
}

export async function getCashFlowTransactions(
  supabase: SupabaseClient,
  filters: CashFlowFilters
): Promise<CashFlowTransactionsResult> {
  const page = normalizePage(filters.page);
  const pageSize = normalizePageSize(filters.pageSize);
  const rows = await getUnifiedTransactions(supabase, filters);
  const start = (page - 1) * pageSize;
  const pagedRows = rows.slice(start, start + pageSize);

  return {
    rows: pagedRows,
    totalCount: rows.length,
    page,
    pageSize,
    hasNextPage: start + pageSize < rows.length,
  };
}

export async function getCashFlowTrend(
  supabase: SupabaseClient,
  filters: CashFlowFilters
): Promise<CashFlowTrendPoint[]> {
  const rows = await getUnifiedTransactions(supabase, filters);
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

  return [...grouped.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export async function getProjectOptions(
  supabase: SupabaseClient
): Promise<ProjectOption[]> {
  const { data, error } = await supabase
    .from("project_dashboard_view")
    .select("id,name")
    .order("name", { ascending: true })
    .limit(500);

  if (error) throw error;

  return ((data ?? []) as ProjectOptionRow[])
    .filter((row) => row.id)
    .map((row) => ({
      id: row.id,
      name: row.name?.trim() || "פרויקט",
    }));
}
