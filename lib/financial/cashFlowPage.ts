import type { SupabaseClient } from "@supabase/supabase-js";
import { getFinancialPageData, type FinancialEntry, type FinancialPageData } from "@/lib/financial";
import { loadProjectedOutflowEntries } from "@/lib/payables";
import { propertyDisplayName } from "@/lib/properties";
import { israelDateKey } from "@/lib/timezone";

// The /financial and /financial/reports data, shared by the page
// (CashFlowPageContent) and GET /api/financial/entries, so the rows the
// browser loads after the page are built exactly the way the page's were.

export type CashFlowSearchParams = Record<string, string | string[] | undefined>;

export type CashFlowInitialFilters = {
  from: string;
  to: string;
  domain: string;
  sourceId: string;
  type: string;
  stage: string;
  q: string;
  ledgerPage: number;
  upcomingPage: number;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeType(value: string | undefined) {
  return value === "inflow" || value === "outflow" ? value : "all";
}

function normalizeStage(value: string | undefined) {
  return value === "actual" || value === "future" || value === "pending" ? value : "all";
}

function normalizePage(value: string | undefined) {
  if (!value) return 1;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

export function normalizeFinancialSearchParams(searchParams: CashFlowSearchParams): CashFlowInitialFilters {
  return {
    from: firstValue(searchParams.from)?.trim() ?? "",
    to: firstValue(searchParams.to)?.trim() ?? "",
    domain: firstValue(searchParams.domain)?.trim() ?? "",
    sourceId: firstValue(searchParams.sourceId)?.trim() ?? "",
    type: normalizeType(firstValue(searchParams.type)),
    stage: normalizeStage(firstValue(searchParams.stage)),
    q: firstValue(searchParams.q)?.trim() ?? "",
    ledgerPage: normalizePage(firstValue(searchParams.ledgerPage)),
    upcomingPage: normalizePage(firstValue(searchParams.upcomingPage)),
  };
}

export function cashFlowCustomerId(searchParams: CashFlowSearchParams) {
  return firstValue(searchParams.customer_id)?.trim() ?? "";
}

/** Expected outgoing money (upcoming salaries + recurring bills) for the
 *  future/forecast views, 6-month horizon. Call once today's recurring expenses
 *  exist; never fails (no projections rather than no page). */
export function loadCashFlowProjections(supabase: SupabaseClient): Promise<FinancialEntry[]> {
  return loadProjectedOutflowEntries(supabase, {
    referenceDate: israelDateKey(),
    months: 6,
  }).catch(() => []);
}

export function loadCashFlowData(
  supabase: SupabaseClient,
  {
    filters,
    customerId,
    notBefore,
    projectedOutflowEntries,
  }: {
    filters: CashFlowInitialFilters;
    customerId: string;
    notBefore: string | null;
    projectedOutflowEntries: FinancialEntry[] | Promise<FinancialEntry[]>;
  }
): Promise<FinancialPageData> {
  return getFinancialPageData(
    supabase,
    {
      customerId: customerId || null,
      from: filters.from || null,
      to: filters.to || null,
      notBefore,
      domain: filters.domain || null,
      sourceId: filters.sourceId || null,
      type: filters.type === "all" ? null : filters.type,
      stage: filters.stage === "all" ? null : filters.stage,
      q: filters.q || null,
      ledgerPage: filters.ledgerPage,
      upcomingPage: filters.upcomingPage,
    },
    { projectedOutflowEntries }
  );
}

// ── What each view sends with the page ──────────────────────────────────────
// The full ledger (up to 1,500 rows, ~1.5 MB) and upcoming list (up to 1,000)
// made /financial heavy to download and parse, and /financial/reports carried
// them without using them at all.

/** Past entries sent with the flow page — enough for the first screens of the
 *  history and full-journal tabs (each starts at 60 rows). */
export const FIRST_PAST_LEDGER_ENTRIES = 150;
/** Upcoming entries sent with the flow page — the nearest ones (it shows 15). */
export const FIRST_UPCOMING_ENTRIES = 150;

/** The ledger arrives newest first: every entry dated after today (the top of
 *  the full journal), then the most recent past ones. */
export function firstLedgerSlice(entries: FinancialEntry[], todayIso: string, pastCount = FIRST_PAST_LEDGER_ENTRIES) {
  let past = 0;
  let end = 0;
  for (; end < entries.length; end++) {
    if ((entries[end].flowDate ?? "") <= todayIso) {
      if (past === pastCount) break;
      past += 1;
    }
  }
  return entries.slice(0, end);
}

/** /financial: the newest rows only (the browser loads the rest right after
 *  from GET /api/financial/entries), and none of the reports-only data. */
export function flowViewData(data: FinancialPageData): { data: FinancialPageData; entriesPartial: boolean } {
  const ledgerEntries = firstLedgerSlice(data.ledgerEntries, data.todayIso);
  const upcomingEntries = data.upcomingEntries.slice(0, FIRST_UPCOMING_ENTRIES);
  return {
    data: {
      ...data,
      ledgerEntries,
      upcomingEntries,
      // Read only by the reports view (FinancialPageClient), and domainGroups
      // by nothing at all.
      domainGroups: [],
      profitLoss: [],
      profitLossProof: {},
      profitLossExpenseCategories: [],
      profitLossPrevious: [],
      loanFlows: { received: [], repaid: [], lent: [], repaidToMe: [], net: 0 },
      monthlyTrend: [],
      forecastMonthly: [],
    },
    entriesPartial:
      ledgerEntries.length < data.ledgerEntries.length || upcomingEntries.length < data.upcomingEntries.length,
  };
}

/** /financial/reports: no ledger lists — only the flow view shows them. */
export function reportsViewData(data: FinancialPageData): FinancialPageData {
  return { ...data, ledgerEntries: [], upcomingEntries: [], domainGroups: [] };
}

// ── The flow view from the device copy (owner, 2026-10-28: "go on with תזרים") ──
// The device works the page out itself, with this same code on its own copy
// (lib/powersync/dashboard-local.ts, card "cashFlow"), and the daily check works
// it out here on the server's data to compare. Nothing to download, so every
// row comes at once (no slice, no second request); the reports-only parts are
// left out as on the server's flow page.

/** The flow view with every row: flowViewData's shape, without its slice. */
export function fullFlowViewData(data: FinancialPageData): FinancialPageData {
  return { ...flowViewData(data).data, ledgerEntries: data.ledgerEntries, upcomingEntries: data.upcomingEntries };
}

export type CashFlowDialogOptions = {
  projects: Array<{ id: string; label: string }>;
  properties: Array<{ id: string; label: string }>;
  orders: Array<{ id: string; label: string }>;
};

type OptionRow = Record<string, unknown>;

function optionString(row: OptionRow, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

/** The expense dialogs' pick-lists: projects (with their customer), active properties, the latest 500 orders. */
export async function loadCashFlowDialogOptions(supabase: SupabaseClient): Promise<CashFlowDialogOptions> {
  // Each list ends its order on the id: rows that tie (orders of the same
  // day) come in the same order every time — on the server and on the device
  // (the daily check compares them, 2026-10-28).
  const [projectsResult, propertiesResult, ordersResult] = await Promise.all([
    // project_overview_view has project_dashboard_view's rows without the
    // financial and task totals these options never read.
    supabase
      .from("project_overview_view")
      .select("id,name,customer_name")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(0, 999),
    supabase
      .from("properties")
      .select("id,name,address,is_active")
      .order("address", { ascending: true })
      .order("id", { ascending: true })
      .range(0, 999),
    supabase
      .from("order_overview_view")
      .select("order_id,customer_name,order_date")
      .order("order_date", { ascending: false })
      .order("order_id", { ascending: true })
      .range(0, 499),
  ]);
  const projects = ((projectsResult.data ?? []) as OptionRow[])
    .map((row) => {
      const id = optionString(row, "id") ?? "";
      const name = optionString(row, "name") ?? "";
      const customerName = optionString(row, "customer_name");
      return { id, label: customerName ? `${name} (${customerName})` : name };
    })
    .filter((row) => row.id && row.label);
  const properties = ((propertiesResult.data ?? []) as OptionRow[])
    .filter((row) => row.is_active !== false)
    .map((row) => ({
      id: optionString(row, "id") ?? "",
      label: propertyDisplayName({ name: optionString(row, "name"), address: optionString(row, "address") ?? "" }),
    }))
    .filter((row) => row.id && row.label);
  const orders = ((ordersResult.data ?? []) as OptionRow[])
    .map((row) => {
      const id = optionString(row, "order_id") ?? "";
      const customer = optionString(row, "customer_name");
      // The day only: the server writes the time "+00:00", the device ".000Z".
      const orderDate = optionString(row, "order_date")?.slice(0, 10);
      return {
        id,
        label: customer ? `הזמנה ${id.slice(0, 8)} (${customer}${orderDate ? ` • ${orderDate}` : ""})` : `הזמנה ${id.slice(0, 8)}`,
      };
    })
    .filter((row) => row.id && row.label);
  return { projects, properties, orders };
}

/** What the flow view is worked out for: its filters as the address gives them, and a customer's own view. */
export type CashFlowViewFilters = { filters: CashFlowInitialFilters; customerId: string };

/** The URL's search params → the flow view's filters (the page, the device and the daily check alike). */
export function cashFlowViewFilters(searchParams: CashFlowSearchParams): CashFlowViewFilters {
  return { filters: normalizeFinancialSearchParams(searchParams), customerId: cashFlowCustomerId(searchParams) };
}

/** The flow view: every row of it, and the dialogs' lists. */
export async function loadCashFlowFlowView(
  supabase: SupabaseClient,
  { filters, customerId }: CashFlowViewFilters
): Promise<{ data: FinancialPageData; options: CashFlowDialogOptions }> {
  const [full, options] = await Promise.all([
    loadCashFlowData(supabase, {
      filters,
      customerId,
      notBefore: null,
      projectedOutflowEntries: loadCashFlowProjections(supabase),
    }),
    loadCashFlowDialogOptions(supabase),
  ]);
  return { data: fullFlowViewData(full), options };
}
