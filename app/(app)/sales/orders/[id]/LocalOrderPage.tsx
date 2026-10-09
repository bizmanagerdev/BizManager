"use client";

import { useEffect, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import OrderPageSkeleton from "@/app/(app)/sales/orders/[id]/OrderPageSkeleton";
import { useLocalCard } from "@/components/powersync/useLocalCard";
import { useDevicePageTiming } from "@/components/powersync/useDevicePageTiming";
import { useSettled } from "@/hooks/useSettled";
import { emitNavigationContentShown } from "@/components/layout/TopNavigationProgress";
import type { LocalCardViewer } from "@/lib/powersync/dashboard-local";
import OrderPagePreview from "@/app/(app)/sales/orders/[id]/OrderPagePreview";
import OrderPageView from "@/app/(app)/sales/orders/[id]/OrderPageView";
import type { OrderPreview } from "@/app/(app)/sales/orders/[id]/orderPreview";
import type { OrderPageExtras } from "@/app/(app)/sales/orders/[id]/loadOrderPageExtras";

// An order's page drawn from the on-device copy (LOCAL_DATA_PAGES.orders): the
// order, its lines and stock, its payments and money, the customer — worked
// out with the server's own loader (lib/orders/order-page.ts) on the device,
// and again by itself whenever any of it changes. What only the server reads
// (the Morning documents, the delivery photos, the history) follows from the
// server (`extras`) and fills in its sections when it arrives.
//
// Drawn three ways, all from the same kept result, so nothing changes on
// screen between them: over the orders list the moment a row is tapped
// (RouteOpeningOverlay), as the page's loading screen, and as the page itself.
// An order this device's copy doesn't hold (made a moment ago elsewhere, not
// synced yet) waits a little for it, then reloads as the server version.

/** How long an order missing from the copy is waited for before the server version. */
const MISSING_ORDER_WAIT_MS = 2500;

export default function LocalOrderPage({
  id,
  viewer,
  extras,
  preview = null,
}: {
  id: string;
  viewer: LocalCardViewer & { name: string | null };
  /** The parts only the server reads — null before the page has arrived (on a tap, the loading screen). */
  extras: PromiseLike<OrderPageExtras> | null;
  /** What the orders list knew about it, shown until the device has worked it out. */
  preview?: OrderPreview | null;
}) {
  const router = useRouter();
  const serverHref = `/sales/orders/${encodeURIComponent(id)}?data=server`;
  const { userId, role, locale } = viewer;
  const card = useLocalCard({
    kind: "orderPage",
    viewer: { userId, role, locale },
    filters: { id },
    page: "orders",
    serverHref,
  });
  // Another order's page for a moment (the previous result) never stands in.
  const shown = card && card.data.filters.id === id ? card : null;
  const missing = shown !== null && shown.data.order === null;
  useDevicePageTiming("order", missing ? null : shown, shown?.data.items.length);
  const settledExtras = useSettled(extras, id);

  useEffect(() => {
    if (!missing) return;
    const timer = setTimeout(() => router.replace(serverHref), MISSING_ORDER_WAIT_MS);
    return () => clearTimeout(timer);
  }, [missing, router, serverHref]);

  // On screen with its content: the top bar is done (it would otherwise run on
  // until the server's answer for the page arrives behind it).
  const contentOnScreen = shown !== null && !missing;
  useLayoutEffect(() => {
    if (contentOnScreen) emitNavigationContentShown();
  }, [contentOnScreen]);

  if (!shown || missing) return preview ? <OrderPagePreview preview={preview} routeLoading /> : <OrderPageSkeleton routeLoading />;

  return (
    <OrderPageView
      id={id}
      core={shown.data}
      extras={settledExtras}
      viewer={{ role, name: viewer.name }}
    />
  );
}
