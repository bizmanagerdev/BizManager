"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useLocalCard } from "@/components/powersync/useLocalCard";
import { useDevicePageTiming } from "@/components/powersync/useDevicePageTiming";
import type { LocalCardViewer } from "@/lib/powersync/dashboard-local";
import { cashFlowViewFilters } from "@/lib/financial/cashFlowPage";
import { CashFlowSkeleton } from "./FinancialSkeleton";

// The same placeholder as loading.tsx while the client's code loads.
const FinancialPage = dynamic(() => import("./FinancialPageClient").then((m) => m.FinancialPage), {
  loading: () => <CashFlowSkeleton />,
});

// The cash-flow page drawn from the on-device copy (LOCAL_DATA_PAGES.cashFlow):
// its flow view — every row at once — and the dialogs' lists, worked out with
// the server's own code (loadCashFlowFlowView) on the device, for the filters
// in the address; again by itself whenever a table it reads changes. A filter
// changed is worked out on the device too: no trip to the server. Saves still
// go to the server and come back through the copy. If the device's copy can't
// serve the page, it reloads as the server version (?data=server).

export default function LocalCashFlowPage({ viewer }: { viewer: LocalCardViewer }) {
  const searchParams = useSearchParams();
  const paramsKey = searchParams.toString();
  const params = useMemo(() => Object.fromEntries(new URLSearchParams(paramsKey)), [paramsKey]);
  const filters = useMemo(() => cashFlowViewFilters(params), [params]);
  const serverHref = useMemo(() => {
    const next = new URLSearchParams(paramsKey);
    next.set("data", "server");
    return `/financial?${next.toString()}`;
  }, [paramsKey]);

  const page = useLocalCard({ kind: "cashFlow", viewer, filters, page: "cashFlow", serverHref });
  useDevicePageTiming("cashFlow", page, page?.data.data.ledgerEntries.length);

  // Money: the page is always drawn for the filters its figures were worked
  // out for. A filter just changed keeps it on screen with the loading bar —
  // its own controls already show the new choice, as on the server's page
  // while a filter loads — until the device has the new filters' page. The
  // drawn page is kept as it is meanwhile (the same element): redrawing every
  // row only to show the bar cost as much as drawing the new figures.
  const shown = page?.data;
  const focusId = params.focus ?? null;
  const customerPage = params.customer_page?.trim() ?? "";
  const customerName = params.customer_name?.trim() ?? "";
  const drawn = useMemo(() => {
    if (!shown) return null;
    const { filters: shownFilters, data, options } = shown;
    const initialFilters = shownFilters.filters;
    return (
      <FinancialPage
        // As on the server's page: a new filter starts the page over.
        key={JSON.stringify({
          customerId: shownFilters.customerId,
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
        entriesPartial={false}
        filtersOnDevice
        focusId={focusId}
        initialFilters={initialFilters}
        view="flow"
        canManageExpenses={viewer.role === "admin" || viewer.role === "office"}
        canViewCashflow={viewer.role === "admin"}
        recurringProjects={options.projects}
        recurringProperties={options.properties}
        recurringOrders={options.orders}
      />
    );
  }, [shown, focusId, customerPage, customerName, viewer.role]);

  if (!page) return <CashFlowSkeleton />;
  const pending = page.filtersKey !== JSON.stringify(filters);
  return (
    <div className="relative">
      {/* The page's own loading bar (FinancialPage's), at its place. */}
      {pending ? (
        <div className="pointer-events-none absolute inset-x-0 -top-1 z-20 h-1 overflow-hidden rounded-full bg-primary/15 print:hidden">
          <div className="h-full w-full rounded-full bg-primary animate-progress-indeterminate" />
        </div>
      ) : null}
      {drawn}
    </div>
  );
}
