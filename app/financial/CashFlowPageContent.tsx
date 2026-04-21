import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import type { UserProfile } from "@/lib/auth/requireProfile";
import {
  getCashFlowPageData,
  getCashFlowSourceKind,
  getDomainOptions,
  getSourceOptions,
  type CashFlowFilters as CashFlowFilterValues,
} from "@/lib/cashflow";
import type { SupabaseClient } from "@supabase/supabase-js";
import CashFlowFilters from "@/app/dashboard/cashflow/CashFlowFilters";
import CashFlowBalanceChart from "@/app/dashboard/cashflow/CashFlowBalanceChart";
import CashFlowProjectBreakdown from "@/app/dashboard/cashflow/CashFlowProjectBreakdown";
import CashFlowSummaryCards from "@/app/dashboard/cashflow/CashFlowSummaryCards";
import CashFlowTrend from "@/app/dashboard/cashflow/CashFlowTrend";
import CashFlowTransactions from "@/app/dashboard/cashflow/CashFlowTransactions";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeCashFlowSearchParams(
  searchParams: Record<string, string | string[] | undefined>
): CashFlowFilterValues {
  const page = Number(firstValue(searchParams.page) ?? "1");

  return {
    from: firstValue(searchParams.from) ?? null,
    to: firstValue(searchParams.to) ?? null,
    customerId: firstValue(searchParams.customer_id) ?? null,
    domain: firstValue(searchParams.domain) as CashFlowFilterValues["domain"],
    sourceId: firstValue(searchParams.sourceId) ?? null,
    type: (firstValue(searchParams.type) as CashFlowFilterValues["type"]) ?? "all",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: 20,
  };
}

function searchParamsForLinks(filters: CashFlowFilterValues) {
  const params: Record<string, string> = {};
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.customerId) params.customer_id = filters.customerId;
  if (filters.domain) params.domain = filters.domain;
  if (filters.sourceId) params.sourceId = filters.sourceId;
  if (filters.type && filters.type !== "all") params.type = filters.type;
  return params;
}

function buildCustomerReturnHref(
  customerId: string | null,
  customerName: string | null,
  customerPage: string | null
) {
  if (!customerId) return "/customers";
  const params = new URLSearchParams({ customer_id: customerId });
  if (customerName) params.set("customer_name", customerName);
  if (customerPage) params.set("page", customerPage);
  return `/customers?${params.toString()}`;
}

export default async function CashFlowPageContent({
  profile,
  supabase,
  searchParams,
  basePath,
}: {
  profile: UserProfile;
  supabase: SupabaseClient;
  searchParams: Record<string, string | string[] | undefined>;
  basePath: string;
}) {
  const filters = normalizeCashFlowSearchParams(searchParams);
  const customerName = firstValue(searchParams.customer_name)?.trim() ?? "";
  const customerPage = firstValue(searchParams.customer_page)?.trim() ?? "";

  const sourceKind = getCashFlowSourceKind(filters.domain);
  const [{ summary, transactions, trend, cumulativeTrend, domainBreakdown }, domainOptions, sourceOptions] =
    await Promise.all([
      getCashFlowPageData(supabase, filters),
      Promise.resolve(getDomainOptions()),
      getSourceOptions(supabase, filters.domain, filters.customerId),
    ]);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4" dir="rtl">
        <section className="flex flex-col gap-3 text-right sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">תזרים מזומנים</h1>
            {customerName ? <div className="text-lg font-medium">לקוח: {customerName}</div> : null}
            <p className="text-sm text-muted-foreground">
              מעקב אחרי כסף שנכנס, כסף שיצא, ויתרת התזרים בפועל.
            </p>
          </div>
          {filters.customerId ? (
            <Link
              href={buildCustomerReturnHref(filters.customerId, customerName || null, customerPage || null)}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-input bg-background px-4 text-sm font-medium shadow-sm transition-all duration-200 hover:bg-accent"
            >
              חזרה ללקוח
            </Link>
          ) : null}
        </section>

        <CashFlowFilters
          actionPath={basePath}
          from={filters.from ?? ""}
          to={filters.to ?? ""}
          customerId={filters.customerId ?? ""}
          customerName={customerName}
          customerPage={customerPage}
          domain={filters.domain ?? ""}
          sourceId={filters.sourceId ?? ""}
          sourceKind={sourceKind}
          sourceOptions={sourceOptions}
          type={filters.type ?? "all"}
          projects={domainOptions}
        />

        <CashFlowSummaryCards summary={summary} />

        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <CashFlowTrend rows={trend} />
          <CashFlowBalanceChart rows={cumulativeTrend} />
        </section>

        <CashFlowProjectBreakdown rows={domainBreakdown} />

        <CashFlowTransactions
          basePath={basePath}
          result={transactions}
          searchParams={searchParamsForLinks(filters)}
        />
      </div>
    </AppShell>
  );
}
