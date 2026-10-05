import type { SupabaseClient } from "@supabase/supabase-js";
import { getFinancialPageData, type FinancialEntry, type FinancialPageData } from "@/lib/financial";
import { loadProjectedOutflowEntries } from "@/lib/payables";

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
    referenceDate: new Date().toISOString().slice(0, 10),
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
