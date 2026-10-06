import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import AppShell from "@/components/layout/AppShell";
import { DetailPageSkeleton } from "@/components/layout/DetailPageSkeleton";
import SalesDeliveriesQueue from "@/app/(app)/sales/SalesDeliveriesQueue";
import InventoryRealtimeBadge from "@/app/(app)/sales/InventoryRealtimeBadge";
import SalesTabsNav from "@/app/(app)/sales/SalesTabsNav";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withLoadedAt } from "@/lib/loaded-at";
import { DELIVERY_REGIONS } from "@/lib/ui/cities";
import { loadOrdersPage } from "@/app/(app)/sales/loadOrders";
import { loadPriceListPage, loadInventoryListPage } from "@/app/(app)/sales/loadProducts";
import { loadDeliveriesPage } from "@/app/(app)/sales/loadDeliveries";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import type { DashboardShadowCards } from "@/lib/powersync/dashboard-shadow";
import { LOCAL_DATA_SHADOW, localDataEnabledFor } from "@/lib/powersync/config";
import { israelDateKey } from "@/lib/timezone";

const SalesInventoryClient = dynamic(() => import("@/app/(app)/sales/SalesInventoryClient"), {
  loading: () => <DetailPageSkeleton />,
});
const SalesOrdersClient = dynamic(() => import("@/app/(app)/sales/SalesOrdersClient"), {
  loading: () => <DetailPageSkeleton />,
});
const PriceListClient = dynamic(() => import("@/app/(app)/sales/PriceListClient"), {
  loading: () => <DetailPageSkeleton />,
});

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

  // The page's reads and the "who's asking" check go out together, and the
  // tab counts alongside the tab's own list rather than before it. They run
  // under the caller's own RLS whatever their role, and a caller who isn't
  // staff is still redirected below before anything is rendered.
  const supabase = await createSupabaseServerClient();
  const profilePromise = requireStaffPage();
  const countsPromise = Promise.all([
    (() => {
      // Tab count — only needs status/customer_id, so it counts the plain
      // orders table rather than order_overview_view (which forces a
      // total_paid/remaining_balance aggregation per count).
      let query = applyOpenOrdersFilter(
        supabase
        .from("orders")
        .select("id", { count: "estimated", head: true })
      );
      if (customerId) query = query.eq("customer_id", customerId);
      return query;
    })(),
    (() => {
      if (paymentStatusFilter) {
        // Payment-status filter genuinely needs the view's computed
        // total_paid/remaining_balance columns.
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
      }
      // No payment-status filter — only needs status/customer_id, so count
      // the plain orders table rather than order_overview_view (which forces
      // a total_paid/remaining_balance aggregation per count).
      let query = supabase
        .from("orders")
        .select("id", { count: "estimated", head: true })
        .in("status", CLOSED_ORDER_STATUSES);
      if (customerId) query = query.eq("customer_id", customerId);
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

  // The active tab's first page, stamped with when it was read: the tabs and
  // the nav fetch this page ahead of a click, and a list shown from a copy
  // that has aged refreshes itself (useInfiniteScroll's loadedAt).
  const ordersPromise =
    activeTab === "orders" || activeTab === "closed"
      ? withLoadedAt(
          loadOrdersPage(supabase, {
            page: 1,
            filters: {
              tab: activeTab,
              customerId,
              q: searchQuery,
              paymentStatus: paymentStatusFilter,
              invoice: invoiceFilter,
            },
          })
        )
      : null;
  const priceListPromise =
    activeTab === "price-list"
      ? withLoadedAt(
          loadPriceListPage(supabase, { page: 1, filters: { q: searchQuery, category: categoryFilter } })
        )
      : null;
  const inventoryPromise =
    activeTab === "inventory"
      ? withLoadedAt(
          loadInventoryListPage(supabase, { page: 1, filters: { q: searchQuery, category: categoryFilter } })
        )
      : null;
  const deliveriesPromise =
    activeTab === "deliveries"
      ? withLoadedAt(loadDeliveriesPage(supabase, { page: 1, filters: { customerId } }))
      : null;
  // Settled below; until then a redirect from the check mustn't leave them
  // as unhandled rejections.
  for (const pending of [countsPromise, ordersPromise, priceListPromise, inventoryPromise, deliveriesPromise]) {
    pending?.catch(() => {});
  }

  const { profile } = await profilePromise;
  const [
    { count: openOrdersCount },
    { count: closedOrdersCount },
    { count: productsCount },
    { count: deliveriesCount },
  ] = await countsPromise;

  const salesTabCounts = {
    orders: typeof openOrdersCount === "number" ? openOrdersCount : 0,
    closed: typeof closedOrdersCount === "number" ? closedOrdersCount : 0,
    inventory: typeof productsCount === "number" ? productsCount : 0,
    "price-list": typeof productsCount === "number" ? productsCount : 0,
    deliveries: typeof deliveriesCount === "number" ? deliveriesCount : 0,
  } as const;

  let content: ReactNode = null;
  // The device-copy shadow check for the open tab (lib/powersync/dashboard-shadow.ts) —
  // not for searches, which also read tables the device doesn't hold.
  let shadowCards: DashboardShadowCards | null = null;
  let shadowReadAt = 0; // the open tab's read time (set with shadowCards)

  if (ordersPromise) {
    const { rows: ordersWithDue, totalCount, hasMore, error, loadedAt } = await ordersPromise;
    if (!error && (activeTab === "orders" || activeTab === "closed")) {
      shadowReadAt = loadedAt;
      shadowCards = {
        salesOrders: {
          filters: { tab: activeTab, customerId, q: searchQuery, paymentStatus: paymentStatusFilter, invoice: invoiceFilter },
          rows: ordersWithDue,
          hasMore,
        },
      };
    }

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
        loadedAt={loadedAt}
        canRemind={profile.role === "admin" || profile.role === "office"}
      />
    );
  }

  if (priceListPromise) {
    const { products, categories, totalCount, hasMore, error: loadError, loadedAt } = await priceListPromise;
    if (!loadError) {
      shadowReadAt = loadedAt;
      shadowCards = { salesPriceList: { filters: { q: searchQuery, category: categoryFilter }, products, categories, hasMore } };
    }

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
        loadedAt={loadedAt}
      />
    );
  }

  if (inventoryPromise) {
    const {
      items,
      movements,
      orderCustomerById,
      performerNameById,
      totalCount,
      hasMore,
      error: loadError,
      loadedAt,
    } = await inventoryPromise;
    if (!loadError) {
      shadowReadAt = loadedAt;
      shadowCards = {
        salesInventory: {
          filters: { q: searchQuery, category: categoryFilter },
          items,
          movements,
          orderCustomerById,
          performerNameById,
          hasMore,
        },
      };
    }

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
        loadedAt={loadedAt}
      />
    );
  }

  if (deliveriesPromise) {
    const { deliveries, totalCount, hasMore, error: loadError, loadedAt } = await deliveriesPromise;
    if (!loadError) {
      shadowReadAt = loadedAt;
      shadowCards = { salesDeliveries: { filters: { customerId }, deliveries, hasMore } };
    }

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
        loadedAt={loadedAt}
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
        <div className={`sticky ${tabsStickyTop} z-20 -mx-3 -mt-4 flex h-[52px] items-end justify-between gap-3 border-b border-border/60 bg-background px-3 md:-mx-6 md:mt-0 md:px-6 lg:-mx-8 lg:px-8`}>
          <SalesTabsNav activeTab={activeTab} counts={salesTabCounts} searchParams={params} />
          <div className="flex flex-wrap items-center gap-3 pb-2">
            {customerName ? (
              <div className="text-base font-medium sm:text-lg">לקוח: {customerName}</div>
            ) : null}
            {activeTab === "inventory" ? <InventoryRealtimeBadge /> : null}
            {/* No "הזמנה חדשה" button — the app's one quick-create + carries it. */}
          </div>
        </div>
        {content}
        {shadowCards && !searchQuery && LOCAL_DATA_SHADOW.sales && localDataEnabledFor(profile.role) ? (
          <DashboardLocalShadow
            snapshot={{
              renderedAt: new Date(shadowReadAt).toISOString(),
              userId: profile.id,
              role: profile.role ?? "",
              locale: profile.locale,
              todayIso: israelDateKey(),
              cards: shadowCards,
            }}
          />
        ) : null}
      </div>
    </AppShell>
  );
}
