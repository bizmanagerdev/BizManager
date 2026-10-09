"use client";

import OrderPageSkeleton from "@/app/(app)/sales/orders/[id]/OrderPageSkeleton";
import { localDataPageOn } from "@/lib/powersync/config";
import { useLocalDatabase, useLocalSyncStatus, useLocalViewer } from "@/lib/powersync/store";
import LocalOrderPage from "@/app/(app)/sales/orders/[id]/LocalOrderPage";
import OrderPagePreview from "@/app/(app)/sales/orders/[id]/OrderPagePreview";
import type { OrderPreview } from "@/app/(app)/sales/orders/[id]/orderPreview";

// An order's page before the server's answer for it has arrived — over the
// orders list the moment a row is tapped, and as the page's loading screen.
// With a complete copy of the data on this device, the page itself, drawn from
// it (LocalOrderPage); otherwise the order named from its list row
// (OrderPagePreview), or the page's frame with blanks (OrderPageSkeleton).
export default function OrderPageOpening({
  id,
  preview,
  routeLoading = false,
}: {
  id: string;
  preview: OrderPreview | null;
  /** The route's loading screen (for the top progress bar). */
  routeLoading?: boolean;
}) {
  const viewer = useLocalViewer();
  const db = useLocalDatabase();
  const status = useLocalSyncStatus();
  if (viewer && db && status?.hasSynced && localDataPageOn("orders", viewer)) {
    return (
      <LocalOrderPage
        id={id}
        viewer={{ userId: viewer.id, role: viewer.role, locale: viewer.locale, name: viewer.name }}
        extras={null}
        preview={preview}
      />
    );
  }
  return preview ? <OrderPagePreview preview={preview} routeLoading={routeLoading} /> : <OrderPageSkeleton routeLoading={routeLoading} />;
}
