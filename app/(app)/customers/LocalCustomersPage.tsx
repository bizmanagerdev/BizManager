"use client";

import { useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { LocalListPagerProvider } from "@/components/powersync/LocalListPager";
import { useLocalCard } from "@/components/powersync/useLocalCard";
import { useDevicePageTiming } from "@/components/powersync/useDevicePageTiming";
import { LIST_STORED_MAX_AGE_MS } from "@/lib/powersync/stored-results";
import { loadLocalDataCode, localClient } from "@/lib/powersync/local-results";
import { useLocalDatabase } from "@/lib/powersync/store";
import type { LocalCardViewer } from "@/lib/powersync/dashboard-local";
import { parseCustomersFilters } from "@/app/(app)/customers/customersFilters";
import CustomersSkeleton, { CustomersStripSkeleton } from "@/app/(app)/customers/CustomersSkeleton";
import CustomersTitle from "@/app/(app)/customers/CustomersTitle";

const CustomersClient = dynamic(() => import("@/app/(app)/customers/CustomersClient"), {
  loading: () => (
    <>
      <CustomersTitle />
      <CustomersStripSkeleton />
      <CustomersSkeleton />
    </>
  ),
});

// The /customers list drawn from the on-device copy (LOCAL_DATA_PAGES.customers):
// the first page and the next ones as it scrolls, with each customer's money,
// worked out with the server's own loader (loadCustomersPage) on the device —
// again by itself whenever a customer, order, payment or project changes. The
// filters come from the address, as on the server version, so changing them
// is served from the device too. A search still goes to the server (its index
// and the filter check). If the device's copy can't serve the list, the page
// reloads as the server version (?data=server).

export default function LocalCustomersPage({ viewer }: { viewer: LocalCardViewer }) {
  const searchParams = useSearchParams();
  const serverHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("data", "server");
    return `/customers?${params.toString()}`;
  }, [searchParams]);

  const filters = useMemo(() => parseCustomersFilters((param) => searchParams.get(param)), [searchParams]);
  const list = useLocalCard({
    kind: "customersList",
    viewer,
    filters,
    page: "customers",
    serverHref,
    storedMaxAgeMs: LIST_STORED_MAX_AGE_MS,
  });
  useDevicePageTiming("customers", list, list?.data.rows.length);

  // Page 2, 3… as the list scrolls — from the device too, with the same filters.
  const db = useLocalDatabase();
  const fetchPage = useCallback(
    async (page: number) => {
      if (!db) throw new Error("The device copy isn't open");
      const [[{ computeLocalListPage }], local] = await Promise.all([loadLocalDataCode(), localClient(db)]);
      return computeLocalListPage(local, "customersList", filters, page);
    },
    [db, filters]
  );

  if (!list)
    return (
      <>
        <CustomersTitle />
        <CustomersStripSkeleton />
        <CustomersSkeleton />
      </>
    );

  const { rows, hasMore, totalCount } = list.data;
  return (
    <LocalListPagerProvider fetchPage={fetchPage}>
      <CustomersClient
        initialRows={rows}
        initialHasMore={hasMore}
        totalCount={totalCount}
        // The filters these rows are for — a moment behind the address after
        // a change, while the device works out the new list.
        initialFilters={list.data.filters}
      />
    </LocalListPagerProvider>
  );
}
