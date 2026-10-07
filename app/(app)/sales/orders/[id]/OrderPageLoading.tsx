"use client";

import { useParams } from "next/navigation";
import OrderPageOpening from "@/app/(app)/sales/orders/[id]/OrderPageOpening";
import { orderPreviewSlot } from "@/app/(app)/sales/orders/[id]/orderPreview";
import { useRoutePreview } from "@/hooks/useRoutePreview";

// The order page's loading screen: the page itself from this device's copy
// when it has one (OrderPageOpening); otherwise, opened from the orders list,
// the order named from its row; from anywhere else — or on a full page load,
// where nothing was remembered — the plain skeleton.
export default function OrderPageLoading() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const preview = useRoutePreview(orderPreviewSlot, id);

  return <OrderPageOpening id={id} preview={preview} routeLoading />;
}
