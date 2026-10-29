import dynamic from "next/dynamic";
import AppShell from "@/components/layout/AppShell";
import type { UserProfile } from "@/lib/auth/requireProfile";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CashFlowSkeleton, ReportsSkeleton } from "@/app/(app)/financial/FinancialSkeleton";
import { cashFlowPageKey } from "@/app/(app)/financial/FinancialPage.ui";
import {
  cashFlowCustomerId,
  flowViewData,
  loadCashFlowData,
  loadCashFlowDialogOptions,
  loadCashFlowProjections,
  normalizeFinancialSearchParams,
  reportsViewData,
} from "@/lib/financial/cashFlowPage";
import {
  loadEarnedRevenueByMonth,
  type EarnedRevenueReport,
} from "@/lib/financial/earnedRevenue";
import {
  loadProductMarginByMonth,
  type ProductMarginReport,
} from "@/lib/financial/productMargin";
import {
  loadProjectPeriodBreakdown,
  type ProjectBreakdown,
} from "@/lib/financial/projectBreakdown";
import { loadDomainProof, type DomainProofMap } from "@/lib/financial/domainProof";
import { loadCustomerRanking, type CustomerRankingReport } from "@/lib/financial/customerRanking";
import { ensureRecurringExpensesForDate } from "@/lib/recurring-expenses";
import { clampFromToBooksStart, getBooksStartDate } from "@/lib/settings/booksStartDate";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// This client component is ~2,400 lines (the whole cash-flow ledger UI).
// Lazy-loaded so a visitor doesn't download it before actually opening the
// page — same pattern already used for ProjectTabsClient/SalaryCenterClient.
// While its code loads, each view shows its own placeholder — the same one as
// its loading.tsx — so the page never swaps one placeholder for another.
const FinancialPageClient = dynamic(() => import("@/app/(app)/financial/FinancialPageClient"), {
  loading: () => <CashFlowSkeleton />,
});
const FinancialReportsClient = dynamic(() => import("@/app/(app)/financial/FinancialPageClient"), {
  loading: () => <ReportsSkeleton />,
});

export default async function CashFlowPageContent({
  profile,
  supabase,
  searchParams,
  view = "flow",
}: {
  profile: UserProfile;
  supabase: SupabaseClient;
  searchParams: Record<string, string | string[] | undefined>;
  view?: "flow" | "reports";
}) {
  const customerId = cashFlowCustomerId(searchParams);
  const customerName = firstValue(searchParams.customer_name)?.trim() ?? "";
  const customerPage = firstValue(searchParams.customer_page)?.trim() ?? "";
  const initialFilters = normalizeFinancialSearchParams(searchParams);

  // Reports count only from the books start date (Settings → כספים). The flow
  // view's ledger is history, not a total, so it keeps every row. Started now so
  // the read overlaps the recurring/projection work below.
  const booksStartDatePromise = view === "reports" ? getBooksStartDate(supabase) : Promise.resolve(null);

  // The recurring-expense dialog's pick-lists depend on nothing else here —
  // started now so they load alongside the ledger instead of after it.
  const canManageExpenses = profile.role === "admin" || profile.role === "office";
  const optionsPromise = canManageExpenses ? loadCashFlowDialogOptions(supabase) : null;
  // Awaited further down. This only stops a failure that lands meanwhile from
  // being reported as unhandled before then.
  optionsPromise?.catch(() => {});

  // Expected outgoing money (upcoming salaries + recurring bills) to show in the
  // future/forecast views alongside expected income — 6-month horizon, calendar-
  // parity. Only for the roles that can see cash flow; never blocks the page.
  // Loaded alongside the ledger scan: getFinancialPageData awaits it only once
  // the entries are in.
  const canSeeCashflow = profile.role === "admin" || profile.role === "office";
  if (canSeeCashflow) {
    await ensureRecurringExpensesForDate(supabase);
  }
  const projectedOutflowEntries = canSeeCashflow ? loadCashFlowProjections(supabase) : [];

  const booksStartDate = await booksStartDatePromise;
  const reportFrom = clampFromToBooksStart(initialFilters.from, booksStartDate);

  // Earned (booked) revenue per month per domain + per-project breakdown — only
  // needed on the reports view (the per-project detail proves the פרויקטים total).
  // Started before the ledger is awaited, so the two run side by side.
  const reportsPromise =
    view === "reports"
      ? Promise.all([
          loadEarnedRevenueByMonth(supabase, {
            from: reportFrom,
            to: initialFilters.to || null,
          }),
          loadProjectPeriodBreakdown(supabase, {
            from: reportFrom,
            to: initialFilters.to || null,
          }),
          loadDomainProof(supabase, {
            from: reportFrom,
            to: initialFilters.to || null,
          }),
          // Customer analytics are book-wide (not date-scoped) — always the latest picture.
          loadCustomerRanking(supabase),
          loadProductMarginByMonth(supabase, {
            from: reportFrom,
            to: initialFilters.to || null,
          }),
        ])
      : null;
  reportsPromise?.catch(() => {});

  const fullData = await loadCashFlowData(supabase, {
    filters: initialFilters,
    customerId,
    notBefore: booksStartDate,
    projectedOutflowEntries,
  });
  // Each view gets only what it shows: the flow view its newest ledger rows
  // (FinancialPageClient loads the rest right after the page, from
  // /api/financial/entries), the reports view no ledger lists at all.
  const { data, entriesPartial } =
    view === "reports" ? { data: reportsViewData(fullData), entriesPartial: false } : flowViewData(fullData);

  const canViewCashflow = profile.role === "admin";

  let earnedRevenue: EarnedRevenueReport | null = null;
  let projectBreakdown: ProjectBreakdown | null = null;
  let domainProof: DomainProofMap | null = null;
  let customerRanking: CustomerRankingReport | null = null;
  let productMargin: ProductMarginReport | null = null;
  if (reportsPromise) {
    [earnedRevenue, projectBreakdown, domainProof, customerRanking, productMargin] = await reportsPromise;
  }

  const options = optionsPromise ? await optionsPromise : { projects: [], properties: [], orders: [] };

  const PageClient = view === "reports" ? FinancialReportsClient : FinancialPageClient;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <PageClient
        key={cashFlowPageKey({ customerId, customerPage, customerName })}
        data={data}
        entriesPartial={entriesPartial}
        earnedRevenue={earnedRevenue}
        projectBreakdown={projectBreakdown}
        domainProof={domainProof}
        customerRanking={customerRanking}
        productMargin={productMargin}
        booksStartDate={booksStartDate}
        initialFilters={initialFilters}
        view={view}
        canManageExpenses={canManageExpenses}
        canViewCashflow={canViewCashflow}
        recurringProjects={options.projects}
        recurringProperties={options.properties}
        recurringOrders={options.orders}
      />
    </AppShell>
  );
}
