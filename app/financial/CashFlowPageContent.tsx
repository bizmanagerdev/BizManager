import AppShell from "@/components/layout/AppShell";
import type { UserProfile } from "@/lib/auth/requireProfile";
import type { SupabaseClient } from "@supabase/supabase-js";
import FinancialPageClient, {
  type FinancialPageInitialFilters,
} from "@/app/financial/FinancialPageClient";
import { getFinancialPageData } from "@/lib/financial";
import { ensureRecurringExpensesForDate } from "@/lib/recurring-expenses";

type Row = Record<string, unknown>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getString(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value : null;
}

function getNumber(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function looksLikeMissingSchema(message: string) {
  const value = message.toLowerCase();
  return value.includes("does not exist") || value.includes("could not find") || value.includes("schema cache");
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
}: {
  profile: UserProfile;
  supabase: SupabaseClient;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const customerId = firstValue(searchParams.customer_id)?.trim() ?? "";
  const customerName = firstValue(searchParams.customer_name)?.trim() ?? "";
  const customerPage = firstValue(searchParams.customer_page)?.trim() ?? "";
  const initialFilters = normalizeFinancialSearchParams(searchParams);

  if (profile.role === "admin" || profile.role === "office") {
    await ensureRecurringExpensesForDate(supabase);
  }

  const data = await getFinancialPageData(supabase, {
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
  });

  const canManageExpenses = profile.role === "admin" || profile.role === "office";

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
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
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
        initialFilters={initialFilters}
        customerId={customerId}
        customerName={customerName}
        customerPage={customerPage}
        canManageExpenses={canManageExpenses}
        recurringProjects={projectOptions}
        recurringProperties={propertyOptions}
        recurringOrders={orderOptions}
      />
    </AppShell>
  );
}
