"use client";

import { useEffect, useLayoutEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { showServerVersion, useLocalCard } from "@/components/powersync/useLocalCard";
import { useDevicePageTiming } from "@/components/powersync/useDevicePageTiming";
import { useSettled } from "@/hooks/useSettled";
import { emitNavigationContentShown } from "@/components/layout/TopNavigationProgress";
import { israelDateKey } from "@/lib/timezone";
import type { LocalCardViewer } from "@/lib/powersync/dashboard-local";
import CustomerPageSkeleton from "@/app/(app)/customers/[id]/CustomerPageSkeleton";
import CustomerPageView from "@/app/(app)/customers/[id]/CustomerPageView";
import { mergeCustomerPage, type CustomerServerParts } from "@/app/(app)/customers/[id]/customerPageCore";
import type { CustomerDocumentsResult, CustomerHistory } from "@/app/(app)/customers/[id]/customerPageModel";

// A customer's page drawn from the on-device copy (LOCAL_DATA_PAGES.customerPage):
// the customer, his money, orders, projects, contacts, tags, tasks, leases,
// loans and every payment — worked out with the server's own reads
// (customerPageCore.ts) on the device, and again by itself whenever any of it
// changes. What only the server reads (`serverReads`: the call log, promises,
// Morning documents, a linked worker's pay owed, the documents and history)
// follows from the server and fills in when it arrives — with no signal, the
// page shows without it. A customer this device's copy doesn't hold yet (added
// a moment ago elsewhere) waits a little for it, then the server version.

/** How long a customer missing from the copy is waited for before the server version. */
const MISSING_CUSTOMER_WAIT_MS = 2500;

/** An already-settled promise React's use() reads at once, without a moment's fallback. */
function settled<T>(value: T): Promise<T> {
  return Object.assign(Promise.resolve(value), { status: "fulfilled" as const, value });
}

export default function LocalCustomerPage({
  id,
  viewer,
  serverReads,
}: {
  id: string;
  viewer: LocalCardViewer;
  serverReads: {
    server: PromiseLike<CustomerServerParts>;
    documents: Promise<CustomerDocumentsResult>;
    /** Admin only, mirroring /activity access; null for everyone else. */
    history: Promise<CustomerHistory> | null;
  };
}) {
  const router = useRouter();
  const serverHref = `/customers/${encodeURIComponent(id)}?data=server`;
  const card = useLocalCard({
    kind: "customerPage",
    viewer,
    filters: { id },
    page: "customerPage",
    serverHref,
  });
  // Another customer's page for a moment (the previous result) never stands in.
  const shown = card && card.data.filters.id === id ? card : null;
  const missing = shown !== null && shown.data.core === null;
  useDevicePageTiming("customer", missing ? null : shown, shown?.data.payments.payments.length);
  const serverParts = useSettled(serverReads.server, id);

  useEffect(() => {
    if (!missing) return;
    const timer = setTimeout(() => showServerVersion(router, "customerPage", serverHref), MISSING_CUSTOMER_WAIT_MS);
    return () => clearTimeout(timer);
  }, [missing, router, serverHref]);

  // On screen with its content: the top bar is done (it would otherwise run on
  // until the server's answer for the page arrives behind it).
  const contentOnScreen = shown !== null && !missing;
  useLayoutEffect(() => {
    if (contentOnScreen) emitNavigationContentShown();
  }, [contentOnScreen]);

  const core = shown?.data.core ?? null;
  const payments = shown?.data.payments ?? null;
  const top = useMemo(() => (core ? mergeCustomerPage(core, serverParts) : null), [core, serverParts]);
  const paymentsPromise = useMemo(() => (payments ? settled(payments) : null), [payments]);

  if (!top || !paymentsPromise) return <CustomerPageSkeleton routeLoading />;

  return (
    <CustomerPageView
      top={top}
      payments={paymentsPromise}
      documents={serverReads.documents}
      history={serverReads.history}
      viewer={{ id: viewer.userId, role: viewer.role }}
      // Drawn on the device only (never in the server's HTML): the device's own today.
      today={israelDateKey()}
      serverPartsReady={serverParts !== null}
    />
  );
}
