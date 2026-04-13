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

type CashFlowEntryRow = {
  id: string;
  entry_date: string;
  type: "income" | "expense";
  amount: number | string | null;
  signed_amount: number | string | null;
  project_id: string | null;
  project_name: string | null;
  description: string | null;
  reference: string | null;
};

type CashFlowSummaryScanRow = {
  type: CashFlowEntryRow["type"];
  amount: CashFlowEntryRow["amount"];
};

type CashFlowTrendScanRow = {
  entry_date: string;
  type: CashFlowEntryRow["type"];
  amount: CashFlowEntryRow["amount"];
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

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const SCAN_CHUNK_SIZE = 500;

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

function normalizeEntryType(value: CashFlowEntryRow["type"]): CashFlowType {
  return value === "income" ? "inflow" : "outflow";
}

function normalizeCashFlowEntry(row: CashFlowEntryRow): CashFlowTransaction | null {
  if (!row.id || !row.entry_date) return null;

  const type = normalizeEntryType(row.type);
  const amount = Math.abs(toNumber(row.amount));
  const signedAmount =
    row.signed_amount === null || row.signed_amount === undefined
      ? type === "inflow"
        ? amount
        : -amount
      : toNumber(row.signed_amount);

  return {
    id: row.id,
    date: row.entry_date,
    amount,
    signedAmount,
    type,
    project_id: normalizeProjectId(row.project_id),
    project_name: row.project_name?.trim() || null,
    description: row.description?.trim() || null,
    reference: row.reference?.trim() || null,
  };
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

function applyCashFlowFilters<TQuery extends {
  gte: (column: string, value: string) => TQuery;
  lte: (column: string, value: string) => TQuery;
  eq: (column: string, value: string) => TQuery;
  or: (filters: string) => TQuery;
}>(
  query: TQuery,
  filters: CashFlowFilters,
  customerProjectIds: string[] = []
) {
  const from = normalizeDateInput(filters.from);
  const to = normalizeDateInput(filters.to);
  const customerId = normalizeCustomerId(filters.customerId);
  const projectId = normalizeProjectId(filters.projectId);
  const typeFilter = normalizeType(filters.type);

  let nextQuery = query;

  if (from) nextQuery = nextQuery.gte("entry_date", from);
  if (to) nextQuery = nextQuery.lte("entry_date", to);
  if (projectId) nextQuery = nextQuery.eq("project_id", projectId);
  if (customerId) {
    nextQuery =
      customerProjectIds.length > 0
        ? nextQuery.or(`customer_id.eq.${customerId},project_id.in.(${customerProjectIds.join(",")})`)
        : nextQuery.eq("customer_id", customerId);
  }
  if (typeFilter === "inflow") nextQuery = nextQuery.eq("type", "income");
  if (typeFilter === "outflow") nextQuery = nextQuery.eq("type", "expense");

  return nextQuery;
}

async function scanCashFlowEntries<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  filters: CashFlowFilters,
  selectColumns: string,
  onChunk: (rows: T[]) => void | Promise<void>
) {
  const customerProjectIds = await resolveCustomerProjectIds(
    supabase,
    normalizeCustomerId(filters.customerId)
  );

  for (let from = 0; ; from += SCAN_CHUNK_SIZE) {
    const to = from + SCAN_CHUNK_SIZE - 1;
    let query = supabase.from("cash_flow_entries_view").select(selectColumns);
    query = applyCashFlowFilters(query, filters, customerProjectIds);

    const { data, error } = await query
      .order("entry_date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const rows = (data ?? []) as unknown as T[];
    if (rows.length === 0) break;

    await onChunk(rows);

    if (rows.length < SCAN_CHUNK_SIZE) break;
  }
}

export async function getCashFlowSummary(
  supabase: SupabaseClient,
  filters: CashFlowFilters
): Promise<CashFlowSummary> {
  let totalInflow = 0;
  let totalOutflow = 0;

  await scanCashFlowEntries<CashFlowSummaryScanRow>(
    supabase,
    filters,
    "type,amount",
    (rows) => {
      rows.forEach((row) => {
        const amount = Math.abs(toNumber(row.amount));
        if (row.type === "income") totalInflow += amount;
        if (row.type === "expense") totalOutflow += amount;
      });
    }
  );

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
  const from = (page - 1) * pageSize;
  const to = page * pageSize - 1;

  const customerProjectIds = await resolveCustomerProjectIds(
    supabase,
    normalizeCustomerId(filters.customerId)
  );

  let query = supabase.from("cash_flow_entries_view").select(
    "id,entry_date,type,amount,signed_amount,project_id,project_name,description,reference",
    { count: "estimated" }
  );
  query = applyCashFlowFilters(query, filters, customerProjectIds);

  const { data, error, count } = await query
    .order("entry_date", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);

  if (error) throw error;

  const rows = ((data ?? []) as CashFlowEntryRow[])
    .map((row) => normalizeCashFlowEntry(row))
    .filter((row): row is CashFlowTransaction => Boolean(row));

  const totalCount = typeof count === "number" ? count : rows.length;

  return {
    rows,
    totalCount,
    page,
    pageSize,
    hasNextPage: typeof count === "number" ? to + 1 < count : rows.length === pageSize,
  };
}

export async function getCashFlowTrend(
  supabase: SupabaseClient,
  filters: CashFlowFilters
): Promise<CashFlowTrendPoint[]> {
  const from = normalizeDateInput(filters.from);
  const to = normalizeDateInput(filters.to);

  const useDailyGrouping =
    from && to
      ? Math.abs(new Date(to).getTime() - new Date(from).getTime()) / 86400000 <= 90
      : false;

  const grouped = new Map<string, CashFlowTrendPoint>();

  await scanCashFlowEntries<CashFlowTrendScanRow>(
    supabase,
    filters,
    "entry_date,type,amount",
    (rows) => {
      rows.forEach((row) => {
        if (!row.entry_date) return;

        const date = new Date(row.entry_date);
        if (Number.isNaN(date.getTime())) return;

        const period = useDailyGrouping ? dayPeriod(date) : monthPeriod(date);
        const current = grouped.get(period) ?? {
          period,
          inflow: 0,
          outflow: 0,
          net: 0,
        };

        const amount = Math.abs(toNumber(row.amount));
        if (row.type === "income") current.inflow += amount;
        if (row.type === "expense") current.outflow += amount;
        current.net = current.inflow - current.outflow;

        grouped.set(period, current);
      });
    }
  );

  return [...grouped.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export async function getCashFlowCumulativeTrend(
  supabase: SupabaseClient,
  filters: CashFlowFilters
): Promise<CashFlowCumulativePoint[]> {
  const trend = await getCashFlowTrend(supabase, filters);

  let balance = 0;
  return trend.map((point) => {
    balance += point.net;
    return {
      ...point,
      balance,
    };
  });
}

type CashFlowProjectScanRow = {
  project_id: string | null;
  project_name: string | null;
  type: CashFlowEntryRow["type"];
  amount: CashFlowEntryRow["amount"];
};

export async function getCashFlowProjectBreakdown(
  supabase: SupabaseClient,
  filters: CashFlowFilters
): Promise<CashFlowProjectBreakdownPoint[]> {
  const grouped = new Map<string, CashFlowProjectBreakdownPoint>();

  await scanCashFlowEntries<CashFlowProjectScanRow>(
    supabase,
    filters,
    "project_id,project_name,type,amount",
    (rows) => {
      rows.forEach((row) => {
        const key = row.project_id ?? "__unassigned__";
        const current = grouped.get(key) ?? {
          projectId: row.project_id,
          projectName: row.project_name?.trim() || "ללא פרויקט",
          inflow: 0,
          outflow: 0,
          net: 0,
        };

        const amount = Math.abs(toNumber(row.amount));
        if (row.type === "income") current.inflow += amount;
        if (row.type === "expense") current.outflow += amount;
        current.net = current.inflow - current.outflow;

        grouped.set(key, current);
      });
    }
  );

  return [...grouped.values()]
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || b.inflow + b.outflow - (a.inflow + a.outflow))
    .slice(0, 8);
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
      name: row.name?.trim() || "פרויקט",
    }));
}
