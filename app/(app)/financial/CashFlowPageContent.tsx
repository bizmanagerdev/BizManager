import AppShell from "@/components/layout/AppShell";
import type { UserProfile } from "@/lib/auth/requireProfile";
import type { SupabaseClient } from "@supabase/supabase-js";
import FinancialPageClient, {
  type FinancialPageInitialFilters,
} from "@/app/(app)/financial/FinancialPageClient";
import { getFinancialPageData } from "@/lib/financial";
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
import { loadProjectedOutflowEntries } from "@/lib/payables";

type Row = Record<string, unknown>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getString(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value : null;
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

export function normalizeFinancialSearchParams(
  searchParams: Record<string, string | string[] | undefined>
): FinancialPageInitialFilters {
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
  const customerId = firstValue(searchParams.customer_id)?.trim() ?? "";
  const customerName = firstValue(searchParams.customer_name)?.trim() ?? "";
  const customerPage = firstValue(searchParams.customer_page)?.trim() ?? "";
  const initialFilters = normalizeFinancialSearchParams(searchParams);

  // Expected outgoing money (upcoming salaries + recurring bills) to show in the
  // future/forecast views alongside expected income — 6-month horizon, calendar-
  // parity. Only for the roles that can see cash flow; never blocks the page.
  const canSeeCashflow = profile.role === "admin" || profile.role === "office";
  if (canSeeCashflow) {
    await ensureRecurringExpensesForDate(supabase);
  }
  const projectedOutflowEntries = canSeeCashflow
    ? await loadProjectedOutflowEntries(supabase, {
        referenceDate: new Date().toISOString().slice(0, 10),
        months: 6,
      }).catch(() => [])
    : [];

  const data = await getFinancialPageData(
    supabase,
    {
      customerId: customerId || null,
      from: initialFilters.from || null,
      to: initialFilters.to || null,
      domain: initialFilters.domain || null,
      sourceId: initialFilters.sourceId || null,
      type: initialFilters.type === "all" ? null : initialFilters.type,
      stage: initialFilters.stage === "all" ? null : initialFilters.stage,
      q: initialFilters.q || null,
      ledgerPage: initialFilters.ledgerPage,
      upcomingPage: initialFilters.upcomingPage,
    },
    { projectedOutflowEntries }
  );

  const canManageExpenses = profile.role === "admin" || profile.role === "office";
  const canViewCashflow = profile.role === "admin";

  // Earned (booked) revenue per month per domain + per-project breakdown — only
  // needed on the reports view (the per-project detail proves the פרויקטים total).
  let earnedRevenue: EarnedRevenueReport | null = null;
  let projectBreakdown: ProjectBreakdown | null = null;
  let domainProof: DomainProofMap | null = null;
  let customerRanking: CustomerRankingReport | null = null;
  let productMargin: ProductMarginReport | null = null;
  if (view === "reports") {
    [earnedRevenue, projectBreakdown, domainProof, customerRanking, productMargin] = await Promise.all([
      loadEarnedRevenueByMonth(supabase, {
        from: initialFilters.from || null,
        to: initialFilters.to || null,
      }),
      loadProjectPeriodBreakdown(supabase, {
        from: initialFilters.from || null,
        to: initialFilters.to || null,
      }),
      loadDomainProof(supabase, {
        from: initialFilters.from || null,
        to: initialFilters.to || null,
      }),
      // Customer analytics are book-wide (not date-scoped) — always the latest picture.
      loadCustomerRanking(supabase),
      loadProductMarginByMonth(supabase, {
        from: initialFilters.from || null,
        to: initialFilters.to || null,
      }),
    ]);
  }

  let projectOptions: Array<{ id: string; label: string }> = [];
  let propertyOptions: Array<{ id: string; label: string }> = [];
  let orderOptions: Array<{ id: string; label: string }> = [];

  if (canManageExpenses) {
    const [projectsResult, propertiesResult, ordersResult] = await Promise.all([
      supabase
        .from("project_dashboard_view")
        .select("id,name,customer_name")
        .order("updated_at", { ascending: false })
        .range(0, 999),
      supabase
        .from("properties")
        .select("id,address,is_active")
        .order("address", { ascending: true })
        .range(0, 999),
      supabase
        .from("order_overview_view")
        .select("order_id,customer_name,order_date")
        .order("order_date", { ascending: false })
        .range(0, 499),
    ]);

    projectOptions = ((projectsResult.data ?? []) as Row[])
      .map((row) => {
        const id = getString(row, "id") ?? "";
        const name = getString(row, "name") ?? "";
        const customerName = getString(row, "customer_name");
        return { id, label: customerName ? `${name} (${customerName})` : name };
      })
      .filter((row) => row.id && row.label);

    propertyOptions = ((propertiesResult.data ?? []) as Row[])
      .filter((row) => row.is_active !== false)
      .map((row) => ({
        id: getString(row, "id") ?? "",
        label: getString(row, "address") ?? "",
      }))
      .filter((row) => row.id && row.label);

    orderOptions = ((ordersResult.data ?? []) as Row[])
      .map((row) => {
        const id = getString(row, "order_id") ?? "";
        const customer = getString(row, "customer_name");
        const orderDate = getString(row, "order_date");
        return {
          id,
          label: customer ? `הזמנה ${id.slice(0, 8)} (${customer}${orderDate ? ` • ${orderDate}` : ""})` : `הזמנה ${id.slice(0, 8)}`,
        };
      })
      .filter((row) => row.id && row.label);
  }

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <FinancialPageClient
        key={JSON.stringify({
          customerId,
          customerPage,
          customerName,
          from: initialFilters.from,
          to: initialFilters.to,
          domain: initialFilters.domain,
          sourceId: initialFilters.sourceId,
          type: initialFilters.type,
          stage: initialFilters.stage,
          q: initialFilters.q,
        })}
        data={data}
        earnedRevenue={earnedRevenue}
        projectBreakdown={projectBreakdown}
        domainProof={domainProof}
        customerRanking={customerRanking}
        productMargin={productMargin}
        initialFilters={initialFilters}
        view={view}
        canManageExpenses={canManageExpenses}
        canViewCashflow={canViewCashflow}
        recurringProjects={projectOptions}
        recurringProperties={propertyOptions}
        recurringOrders={orderOptions}
      />
    </AppShell>
  );
}
