import Link from "next/link";
import type { ReactNode } from "react";
import AppShell from "@/components/layout/AppShell";
import SalesDeliveriesQueue from "@/app/(app)/sales/SalesDeliveriesQueue";
import SalesInventoryClient from "@/app/(app)/sales/SalesInventoryClient";
import SalesOrdersClient from "@/app/(app)/sales/SalesOrdersClient";
import PriceListClient from "@/app/(app)/sales/PriceListClient";
import SalesTabsNav from "@/app/(app)/sales/SalesTabsNav";
import PageAlertBar from "@/components/reminders/PageAlertBar";
import { requireProfile } from "@/lib/auth/requireProfile";
import { Button } from "@/components/ui/button";
import { DELIVERY_REGIONS } from "@/lib/ui/cities";
import { loadOrdersPage } from "@/app/(app)/sales/loadOrders";
import { loadPriceListPage, loadInventoryListPage } from "@/app/(app)/sales/loadProducts";
import { loadDeliveriesPage } from "@/app/(app)/sales/loadDeliveries";

export const revalidate = 30;

const CLOSED_ORDER_STATUSES = [
  "delivered",
  "completed",
  "closed",
  "cancelled",
  "סופקה",
  "הושלמה",
  "סגורה",
  "בוטלה",
];

function applyOpenOrdersFilter<TQuery extends { not: (...args: [string, string, string]) => TQuery }>(
  query: TQuery
) {
  return query.not("status", "in", `(${CLOSED_ORDER_STATUSES.join(",")})`);
}

function buildDeliveriesRegionHref(
  region: string | null,
  customerId: string | null,
  customerName: string | null,
  customerPage: string | null
) {
  const params = new URLSearchParams();
  params.set("tab", "deliveries");
  if (customerId) params.set("customer_id", customerId);
  if (customerName) params.set("customer_name", customerName);
  if (customerPage) params.set("customer_page", customerPage);
  if (region) params.set("region", region);
  return `/sales?${params.toString()}`;
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams?: Promise<{
    tab?: string;
    customer_id?: string;
    customer_name?: string;
    customer_page?: string;
    ordersPage?: string;
    inventoryPage?: string;
    pricePage?: string;
    deliveriesPage?: string;
    q?: string;
    category?: string;
    payment_status?: string;
    region?: string;
    invoice?: string;
  }>;
}) {
  const params = (await searchParams) ?? {};
  const searchQuery = typeof params.q === "string" ? params.q.trim() : "";
  const categoryFilter = typeof params.category === "string" ? params.category.trim() : "";
  const rawPaymentStatusFilter = typeof params.payment_status === "string" ? params.payment_status.trim() : "";
  const paymentStatusFilter =
    rawPaymentStatusFilter === "paid" ||
    rawPaymentStatusFilter === "partial" ||
    rawPaymentStatusFilter === "unpaid"
      ? rawPaymentStatusFilter
      : "";
  const rawInvoiceFilter = typeof params.invoice === "string" ? params.invoice.trim() : "";
  const invoiceFilter =
    rawInvoiceFilter === "needs" ||
    rawInvoiceFilter === "no" ||
    rawInvoiceFilter === "pending" ||
    rawInvoiceFilter === "sent"
      ? rawInvoiceFilter
      : "";
  const customerId =
    typeof params.customer_id === "string" && params.customer_id.trim()
      ? params.customer_id.trim()
      : null;
  const customerName =
    typeof params.customer_name === "string" && params.customer_name.trim()
      ? params.customer_name.trim()
      : null;
  const customerPage =
    typeof params.customer_page === "string" && params.customer_page.trim()
      ? params.customer_page.trim()
      : null;
  const activeTab =
    params.tab === "closed" || params.tab === "inventory" || params.tab === "price-list" || params.tab === "deliveries"
      ? params.tab
      : "orders";
  const regionFilter =
    params.region === "צפון" || params.region === "מרכז" || params.region === "דרום"
      ? params.region
      : null;

  const { profile, supabase } = await requireProfile();
  const [
    { count: openOrdersCount },
    { count: closedOrdersCount },
    { count: productsCount },
    { count: deliveriesCount },
  ] = await Promise.all([
    (() => {
      let query = applyOpenOrdersFilter(
        supabase
        .from("order_overview_view")
        .select("order_id", { count: "estimated", head: true })
      );
      if (customerId) query = query.eq("customer_id", customerId);
      return query;
    })(),
    (() => {
      let query = supabase
        .from("order_overview_view")
        .select("order_id", { count: "estimated", head: true })
        .in("status", CLOSED_ORDER_STATUSES);
      if (customerId) query = query.eq("customer_id", customerId);
      if (paymentStatusFilter === "paid") {
        query = query.gt("total_paid", 0).lte("remaining_balance", 0.009);
      } else if (paymentStatusFilter === "partial") {
        query = query.gt("total_paid", 0).gt("remaining_balance", 0.009);
      } else if (paymentStatusFilter === "unpaid") {
        query = query.lte("total_paid", 0);
      }
      return query;
    })(),
    supabase.from("products").select("id", { count: "estimated", head: true }),
    (() => {
      let query = applyOpenOrdersFilter(
        supabase
        .from("delivery_overview_view")
        .select("order_id,status", { count: "estimated", head: true })
      );
      if (customerId) query = query.eq("customer_id", customerId);
      return query;
    })(),
  ]);

  const salesTabCounts = {
    orders: typeof openOrdersCount === "number" ? openOrdersCount : 0,
    closed: typeof closedOrdersCount === "number" ? closedOrdersCount : 0,
    inventory: typeof productsCount === "number" ? productsCount : 0,
    "price-list": typeof productsCount === "number" ? productsCount : 0,
    deliveries: typeof deliveriesCount === "number" ? deliveriesCount : 0,
  } as const;

  let content: ReactNode = null;

  if (activeTab === "orders" || activeTab === "closed") {
    const ordersFilters = {
      tab: activeTab,
      customerId,
      q: searchQuery,
      paymentStatus: paymentStatusFilter,
      invoice: invoiceFilter,
    } as const;
    const { rows: ordersWithDue, totalCount, hasMore, error } = await loadOrdersPage(supabase, {
      page: 1,
      filters: ordersFilters,
    });

    content = error ? (
      <p className="text-sm text-destructive">שגיאה בטעינת הזמנות: {error}</p>
    ) : (
      <SalesOrdersClient
        orders={ordersWithDue}
        initialHasMore={hasMore}
        initialQuery={searchQuery}
        showPaymentStatusFilter={activeTab === "closed"}
        view={activeTab === "closed" ? "closed" : "open"}
        tabLabel={activeTab === "closed" ? "הזמנות סגורות" : "הזמנות"}
        initialPaymentFilter={paymentStatusFilter}
        initialInvoiceFilter={invoiceFilter}
        customerId={customerId}
        totalCount={totalCount}
        canRemind={profile.role === "admin" || profile.role === "office"}
      />
    );
  }

  if (activeTab === "price-list") {
    const { products, categories, totalCount, hasMore, error: loadError } = await loadPriceListPage(
      supabase,
      { page: 1, filters: { q: searchQuery, category: categoryFilter } }
    );

    content = loadError ? (
      <p className="text-sm text-destructive">שגיאה בטעינת מחירון: {loadError}</p>
    ) : (
      <PriceListClient
        initialProducts={products}
        initialCategories={categories}
        initialHasMore={hasMore}
        totalCount={totalCount}
        initialQuery={searchQuery}
        initialCategoryFilter={categoryFilter}
      />
    );
  }

  if (activeTab === "inventory") {
    const {
      items,
      movements,
      orderCustomerById,
      performerNameById,
      totalCount,
      hasMore,
      error: loadError,
    } = await loadInventoryListPage(supabase, {
      page: 1,
      filters: { q: searchQuery, category: categoryFilter },
    });

    content = loadError ? (
      <p className="text-sm text-destructive">שגיאה בטעינת מלאי: {loadError}</p>
    ) : (
      <SalesInventoryClient
        initialItems={items}
        movements={movements}
        orderCustomerById={orderCustomerById}
        performerNameById={performerNameById}
        initialHasMore={hasMore}
        totalCount={totalCount}
        initialQuery={searchQuery}
        initialCategoryFilter={categoryFilter}
      />
    );
  }

  if (activeTab === "deliveries") {
    const { deliveries, totalCount, hasMore, error: loadError } = await loadDeliveriesPage(supabase, {
      page: 1,
      filters: { customerId },
    });

    const regionLinks = [
      { label: "הכל", value: null },
      ...DELIVERY_REGIONS.map((r) => ({ label: r, value: r })),
    ].map(({ label, value }) => ({
      label,
      value,
      href: buildDeliveriesRegionHref(value, customerId, customerName, customerPage),
      active: regionFilter === value,
    }));

    content = loadError ? (
      <p className="text-sm text-destructive">שגיאה בטעינת משלוחים: {loadError}</p>
    ) : (
      <SalesDeliveriesQueue
        initialDeliveries={deliveries}
        initialHasMore={hasMore}
        regionFilter={regionFilter}
        regionLinks={regionLinks}
        totalCount={totalCount}
        customerId={customerId}
      />
    );
  }

  // Orders/closed/price-list tabs mount a 52px mobile search toolbar into the
  // dark header (sticky at top-[60px], just under the 60px top bar); the tab bar
  // must sit BELOW it there (top-[112px] = 60 + 52). Desktop hides that toolbar
  // (md:hidden), and inventory/deliveries never mount it, so those stick
  // directly under the 60px top bar.
  const hasMobileToolbar =
    activeTab === "orders" || activeTab === "closed" || activeTab === "price-list";
  const tabsStickyTop = hasMobileToolbar ? "top-[112px] md:top-[60px]" : "top-[60px]";

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        <div className={`sticky ${tabsStickyTop} z-20 -mx-4 -mt-4 flex h-[52px] items-end justify-between gap-3 border-b border-border/60 bg-background px-4 md:-mx-6 md:mt-0 md:px-6 lg:-mx-8 lg:px-8`}>
          <SalesTabsNav activeTab={activeTab} counts={salesTabCounts} searchParams={params} />
          <div className="flex flex-wrap items-center gap-3 pb-2">
            {customerName ? (
              <div className="text-base font-medium sm:text-lg">לקוח: {customerName}</div>
            ) : null}
            <Button asChild className="hidden xl:inline-flex">
              <Link href="/sales/orders/new">הזמנה חדשה</Link>
            </Button>
          </div>
        </div>
        <PageAlertBar keys={["low_stock"]} />
        {content}
      </div>
    </AppShell>
  );
}
