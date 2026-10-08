import { Suspense, type ReactNode } from "react";
import dynamic from "next/dynamic";
import AppShell from "@/components/layout/AppShell";
import { DetailPageSkeleton } from "@/components/layout/DetailPageSkeleton";
import SalesDeliveriesQueue from "@/app/(app)/sales/SalesDeliveriesQueue";
import SalesHeader from "@/app/(app)/sales/SalesHeader";
import LocalSalesPage from "@/app/(app)/sales/LocalSalesPage";
import SalesServerCheck from "@/app/(app)/sales/SalesServerCheck";
import DeviceFrameMark from "@/components/powersync/DeviceFrameMark";
import { deviceCheckDue, devicePageOn } from "@/lib/powersync/device-check";
import { loadSalesTabCounts } from "@/app/(app)/sales/loadSalesCounts";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { serverRenderedAt, withLoadedAt } from "@/lib/loaded-at";
import { DELIVERY_REGIONS } from "@/lib/ui/cities";
import { loadOrdersPage } from "@/app/(app)/sales/loadOrders";
import { loadPriceListPage, loadInventoryListPage } from "@/app/(app)/sales/loadProducts";
import { loadDeliveriesPage } from "@/app/(app)/sales/loadDeliveries";
import DashboardLocalShadow from "@/components/powersync/DashboardLocalShadow";
import type { DashboardShadowCards } from "@/lib/powersync/dashboard-shadow";
import { LOCAL_DATA_PAGES, LOCAL_DATA_SHADOW, localDataEnabledFor } from "@/lib/powersync/config";
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
    data?: string;
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
  // staff is still redirected below before anything is rendered. With the
  // device version on for everyone (LOCAL_DATA_PAGES.sales) they wait for the
  // check instead, and go out only for people without a device copy.
  const supabase = await createSupabaseServerClient();
  const profilePromise = requireStaffPage();
  const startReads = () => {
    const countsPromise = loadSalesTabCounts(supabase, { customerId, paymentStatus: paymentStatusFilter });

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
    return { countsPromise, ordersPromise, priceListPromise, inventoryPromise, deliveriesPromise };
  };
  const earlyReads = LOCAL_DATA_PAGES.sales ? null : startReads();

  const { profile } = await profilePromise;

  const regionLinks = [
    { label: "הכל", value: null },
    ...DELIVERY_REGIONS.map((r) => ({ label: r, value: r })),
  ].map(({ label, value }) => ({
    label,
    value,
    href: buildDeliveriesRegionHref(value, customerId, customerName, customerPage),
    active: regionFilter === value,
  }));

  // The device version (LOCAL_DATA_PAGES.sales): the tab counts and the open
  // tab's list are worked out from this person's on-device copy
  // (LocalSalesPage). Not for searches — they read tables the device doesn't
  // hold. ?data=server is the way back when the copy can't serve it; a device
  // whose copy is still incomplete gets the server version at once. (The
  // early reads, if they went out, are just not waited for.)
  if (params.data !== "server" && !searchQuery && (await devicePageOn("sales", profile))) {
    // Once a day per device, the server's own tab too — streamed after the
    // page, for the device to compare (lib/powersync/device-check.ts).
    const checkDue = LOCAL_DATA_SHADOW.sales && (await deviceCheckDue("sales"));
    return (
      <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
        <div className="space-y-4">
          <DeviceFrameMark page="sales" renderedAt={serverRenderedAt()} />
          <LocalSalesPage
            viewer={{ userId: profile.id, role: profile.role ?? "", locale: profile.locale }}
            activeTab={activeTab}
            customerId={customerId}
            customerName={customerName}
            category={categoryFilter}
            paymentStatus={paymentStatusFilter}
            invoice={invoiceFilter}
            regionFilter={regionFilter}
            regionLinks={regionLinks}
            tabsSearchParams={params}
            canRemind={profile.role === "admin" || profile.role === "office"}
          />
          {checkDue ? (
            <Suspense fallback={null}>
              <SalesServerCheck
                supabase={supabase}
                activeTab={activeTab}
                customerId={customerId}
                category={categoryFilter}
                paymentStatus={paymentStatusFilter}
                invoice={invoiceFilter}
                userId={profile.id}
                role={profile.role ?? ""}
                locale={profile.locale}
              />
            </Suspense>
          ) : null}
        </div>
      </AppShell>
    );
  }

  const { countsPromise, ordersPromise, priceListPromise, inventoryPromise, deliveriesPromise } = earlyReads ?? startReads();
  const salesTabCounts = await countsPromise;

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
        regionsInHeaderStrip
      />
    );
  }

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        <SalesHeader activeTab={activeTab} counts={salesTabCounts} searchParams={params} customerName={customerName} />
        {content}
        {shadowCards && !searchQuery && LOCAL_DATA_SHADOW.sales && localDataEnabledFor(profile.role) ? (
          <DashboardLocalShadow
            snapshot={{
              renderedAt: new Date(shadowReadAt).toISOString(),
              userId: profile.id,
              role: profile.role ?? "",
              locale: profile.locale,
              todayIso: israelDateKey(),
              cards: { ...shadowCards, salesCounts: { filters: { customerId, paymentStatus: paymentStatusFilter }, counts: salesTabCounts } },
            }}
          />
        ) : null}
      </div>
    </AppShell>
  );
}
