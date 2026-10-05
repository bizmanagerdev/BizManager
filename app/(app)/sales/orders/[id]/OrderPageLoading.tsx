"use client";

import { useParams } from "next/navigation";
import { DetailPageSkeleton } from "@/components/layout/DetailPageSkeleton";
import OrderPagePreview from "@/app/(app)/sales/orders/[id]/OrderPagePreview";
import { orderPreviewSlot } from "@/app/(app)/sales/orders/[id]/orderPreview";
import { useRoutePreview } from "@/hooks/useRoutePreview";

// The order page's loading screen. Opened from the orders list, it already
// names the order (what the row knew); from anywhere else — or on a full page
// load, where nothing was remembered — the plain skeleton.
export default function OrderPageLoading() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const preview = useRoutePreview(orderPreviewSlot, id);

  return preview ? <OrderPagePreview preview={preview} routeLoading /> : <DetailPageSkeleton />;
}
