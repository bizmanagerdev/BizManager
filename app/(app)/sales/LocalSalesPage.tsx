"use client";

import { useCallback, useMemo, type ComponentProps, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { DetailPageSkeleton } from "@/components/layout/DetailPageSkeleton";
import { LocalListPagerProvider } from "@/components/powersync/LocalListPager";
import { useLocalCard } from "@/components/powersync/useLocalCard";
import { loadLocalDataCode, localClient } from "@/lib/powersync/local-results";
import type {
  LocalCardViewer,
  LocalDashboardCards,
  LocalPagedKind,
  SalesCountsFilters,
} from "@/lib/powersync/dashboard-local";
import { useLocalDatabase } from "@/lib/powersync/store";
import type { DeliveriesFilters } from "./loadDeliveries";
import type { OrdersFilters, OrdersInvoiceFilter, OrdersPaymentFilter } from "./loadOrders";
import type { ProductsFilters } from "./loadProducts";
import SalesDeliveriesQueue from "./SalesDeliveriesQueue";
import SalesHeader, { type SalesTab } from "./SalesHeader";
import SalesSkeleton from "./SalesSkeleton";

const SalesInventoryClient = dynamic(() => import("./SalesInventoryClient"), { loading: () => <DetailPageSkeleton /> });
const SalesOrdersClient = dynamic(() => import("./SalesOrdersClient"), { loading: () => <DetailPageSkeleton /> });
const PriceListClient = dynamic(() => import("./PriceListClient"), { loading: () => <DetailPageSkeleton /> });

// The /sales page drawn from the on-device copy (LOCAL_DATA_PAGES.sales): the
// tab counts and the open tab's list, worked out with the server's own
// loaders on the device — the first page at once, the next ones as you scroll
// (LocalListPagerProvider), again by itself whenever an order, payment or
// product changes. The same tab bar and list components the server version
// renders. Searches stay on the server version (they read tables the device
// doesn't hold); if the device's copy can't serve the page, it reloads as the
// server version (?data=server).

type TabFilters = OrdersFilters | ProductsFilters | DeliveriesFilters;

function tabCard(
  activeTab: SalesTab,
  f: { customerId: string | null; category: string; paymentStatus: OrdersPaymentFilter; invoice: OrdersInvoiceFilter }
): { kind: LocalPagedKind; filters: TabFilters } {
  switch (activeTab) {
    case "orders":
    case "closed":
      return {
        kind: "salesOrders",
        filters: { tab: activeTab, customerId: f.customerId, q: "", paymentStatus: f.paymentStatus, invoice: f.invoice },
      };
    case "price-list":
      return { kind: "salesPriceList", filters: { q: "", category: f.category } };
    case "inventory":
      return { kind: "salesInventory", filters: { q: "", category: f.category } };
    case "deliveries":
      return { kind: "salesDeliveries", filters: { customerId: f.customerId } };
  }
}

export default function LocalSalesPage({
  viewer,
  activeTab,
  customerId,
  customerName,
  category,
  paymentStatus,
  invoice,
  regionFilter,
  regionLinks,
  tabsSearchParams,
  canRemind,
}: {
  viewer: LocalCardViewer;
  activeTab: SalesTab;
  customerId: string | null;
  customerName: string | null;
  category: string;
  paymentStatus: OrdersPaymentFilter;
  invoice: OrdersInvoiceFilter;
  regionFilter: ComponentProps<typeof SalesDeliveriesQueue>["regionFilter"];
  regionLinks: ComponentProps<typeof SalesDeliveriesQueue>["regionLinks"];
  tabsSearchParams: ComponentProps<typeof SalesHeader>["searchParams"];
  canRemind: boolean;
}) {
  const searchParams = useSearchParams();
  const serverHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("data", "server");
    return `/sales?${params.toString()}`;
  }, [searchParams]);

  const { kind, filters } = tabCard(activeTab, { customerId, category, paymentStatus, invoice });
  const countsFilters: SalesCountsFilters = { customerId, paymentStatus };
  const tab = useLocalCard({ kind, viewer, filters, page: "sales", serverHref });
  const counts = useLocalCard({ kind: "salesCounts", viewer, filters: countsFilters, page: "sales", serverHref });

  // Page 2, 3… as the list scrolls — from the device, with the same filters.
  const db = useLocalDatabase();
  const filtersKey = JSON.stringify(filters);
  const fetchPage = useCallback(
    async (page: number) => {
      if (!db) throw new Error("The device copy isn't open");
      const [[{ computeLocalListPage }], local] = await Promise.all([loadLocalDataCode(), localClient(db)]);
      return computeLocalListPage(local, kind, JSON.parse(filtersKey), page);
    },
    [db, kind, filtersKey]
  );

  // The tab or its filters just changed: what's here is still the previous list.
  const tabData = tab && tab.filtersKey === filtersKey ? tab.data : null;
  if (!tabData || !counts) return <SalesSkeleton />;

  let content: ReactNode = null;
  if (kind === "salesOrders") {
    const { rows, hasMore } = tabData as LocalDashboardCards["salesOrders"];
    content = (
      <SalesOrdersClient
        orders={rows}
        initialHasMore={hasMore}
        initialQuery=""
        showPaymentStatusFilter={activeTab === "closed"}
        view={activeTab === "closed" ? "closed" : "open"}
        tabLabel={activeTab === "closed" ? "הזמנות סגורות" : "הזמנות"}
        initialPaymentFilter={paymentStatus}
        initialInvoiceFilter={invoice}
        customerId={customerId}
        totalCount={activeTab === "closed" ? counts.data.counts.closed : counts.data.counts.orders}
        canRemind={canRemind}
      />
    );
  } else if (kind === "salesPriceList") {
    const { products, categories, hasMore } = tabData as LocalDashboardCards["salesPriceList"];
    content = (
      <PriceListClient
        initialProducts={products}
        initialCategories={categories}
        initialHasMore={hasMore}
        totalCount={counts.data.counts["price-list"]}
        initialQuery=""
        initialCategoryFilter={category}
      />
    );
  } else if (kind === "salesInventory") {
    const { items, movements, orderCustomerById, performerNameById, hasMore } = tabData as LocalDashboardCards["salesInventory"];
    content = (
      <SalesInventoryClient
        initialItems={items}
        movements={movements}
        orderCustomerById={orderCustomerById}
        performerNameById={performerNameById}
        initialHasMore={hasMore}
        totalCount={counts.data.counts.inventory}
        initialQuery=""
        initialCategoryFilter={category}
      />
    );
  } else {
    const { deliveries, hasMore } = tabData as LocalDashboardCards["salesDeliveries"];
    content = (
      <SalesDeliveriesQueue
        initialDeliveries={deliveries}
        initialHasMore={hasMore}
        regionFilter={regionFilter}
        regionLinks={regionLinks}
        totalCount={counts.data.counts.deliveries}
        customerId={customerId}
      />
    );
  }

  return (
    <>
      <SalesHeader activeTab={activeTab} counts={counts.data.counts} searchParams={tabsSearchParams} customerName={customerName} />
      <LocalListPagerProvider fetchPage={fetchPage}>{content}</LocalListPagerProvider>
    </>
  );
}
