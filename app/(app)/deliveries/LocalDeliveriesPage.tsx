"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import PageTitle from "@/components/layout/PageTitle";
import { LocalListPagerProvider } from "@/components/powersync/LocalListPager";
import { useLocalCard } from "@/components/powersync/useLocalCard";
import { useDevicePageTiming } from "@/components/powersync/useDevicePageTiming";
import { loadLocalDataCode, localClient } from "@/lib/powersync/local-results";
import type { LocalCardViewer, LocalDashboardCards } from "@/lib/powersync/dashboard-local";
import { useLocalDatabase } from "@/lib/powersync/store";
import { DELIVERY_REGIONS } from "@/lib/ui/cities";
import SalesDeliveriesQueue from "@/app/(app)/sales/SalesDeliveriesQueue";
import DeliveriesSkeleton from "./DeliveriesSkeleton";

// The drivers' /deliveries drawn from the phone's copy (LOCAL_DATA_PAGES.deliveries
// — owner, 2026-10-11: "download that also to the phone"): the open orders,
// their lines and payments are already on a driver's phone (the worker
// streams), so the run opens at once and with no signal too — the same list
// component and loader as the server version. The region and the customer
// are read from the address here, not handed in by the server: the page's
// saved frame then serves every region (public/sw.js ANY_QUERY_FRAME_PATHS),
// opened online or not. If the copy can't serve the page, it reloads as the
// server version (?data=server).

const REGIONS = new Set<string>(DELIVERY_REGIONS);

export default function LocalDeliveriesPage({
  viewer,
  canOpenOrder,
}: {
  viewer: LocalCardViewer;
  canOpenOrder: boolean;
}) {
  const searchParams = useSearchParams();
  const regionParam = searchParams.get("region");
  const regionFilter = regionParam && REGIONS.has(regionParam) ? (regionParam as (typeof DELIVERY_REGIONS)[number]) : null;
  const customerParam = searchParams.get("customer_id")?.trim();
  const customerId = customerParam ? customerParam : null;

  const serverHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("data", "server");
    return `/deliveries?${params.toString()}`;
  }, [searchParams]);

  const regionLinks = useMemo(() => {
    const hrefFor = (region: string | null) => {
      const next = new URLSearchParams();
      if (customerId) next.set("customer_id", customerId);
      if (region) next.set("region", region);
      const query = next.toString();
      return query ? `/deliveries?${query}` : "/deliveries";
    };
    return [{ label: "הכל", value: null as string | null }, ...DELIVERY_REGIONS.map((region) => ({ label: region, value: region }))].map(
      ({ label, value }) => ({ label, value, href: hrefFor(value), active: regionFilter === value })
    );
  }, [customerId, regionFilter]);

  const filters = useMemo(() => ({ customerId }), [customerId]);
  const run = useLocalCard({ kind: "deliveriesRun", viewer, filters, page: "deliveries", serverHref });
  useDevicePageTiming("deliveries", run);

  // Page 2, 3… as the list scrolls — from the phone too, with the same filters.
  const db = useLocalDatabase();
  const fetchPage = useCallback(
    async (page: number) => {
      if (!db) throw new Error("The device copy isn't open");
      const [[{ computeLocalListPage }], local] = await Promise.all([loadLocalDataCode(), localClient(db)]);
      return computeLocalListPage(local, "salesDeliveries", filters, page);
    },
    [db, filters]
  );

  if (!run) return <DeliveriesSkeleton />;
  const { deliveries, hasMore, totalCount } = run.data as LocalDashboardCards["deliveriesRun"];
  return (
    <div className="space-y-4" dir="rtl">
      <PageTitle title="משלוחים" subtitle={`${totalCount} פתוחים`} />
      <LocalListPagerProvider fetchPage={fetchPage}>
        <SalesDeliveriesQueue
          // A new region or customer is a new list (the queue keeps its own rows).
          key={`${regionFilter ?? ""}|${customerId ?? ""}`}
          initialDeliveries={deliveries}
          initialHasMore={hasMore}
          regionFilter={regionFilter}
          regionLinks={regionLinks}
          totalCount={totalCount}
          customerId={customerId}
          canOpenOrder={canOpenOrder}
        />
      </LocalListPagerProvider>
    </div>
  );
}
