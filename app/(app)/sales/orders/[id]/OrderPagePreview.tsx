"use client";

import { useSetPageTitle } from "@/components/layout/page-title-context";
import { HeaderActionsPlaceholder } from "@/components/layout/HeaderActionsMenu";
import OrderPageHeading from "@/app/(app)/sales/orders/[id]/OrderPageHeading";
import OrderPageSkeleton from "@/app/(app)/sales/orders/[id]/OrderPageSkeleton";
import type { OrderPreview } from "@/app/(app)/sales/orders/[id]/orderPreview";

// An order page before its data arrives: named like the page — "הזמנה" and
// the customer in the phone's top bar, the same heading on desktop — over the
// page's own frame with blanks where the figures will be (OrderPageSkeleton),
// so when the page lands the heading doesn't move and the blanks fill in.
// Rendered over the list the moment a row is tapped (RouteOpeningOverlay) and
// as the page's loading screen (OrderPageLoading).

// The page's ⋮ (OrderHeaderMenu), held in place until it arrives — one
// element, so the bar's title isn't re-set on every render.
const HEADER_MENU_PLACEHOLDER = <HeaderActionsPlaceholder />;

function ActionsSkeleton() {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-9 w-20 animate-pulse rounded-md bg-muted/60" />
      ))}
    </div>
  );
}

export default function OrderPagePreview({
  preview,
  routeLoading = false,
}: {
  preview: OrderPreview;
  /** Marks this as the route's loading screen for the top progress bar. */
  routeLoading?: boolean;
}) {
  // Named in the phone's top bar as on the page, beside the ⋮ the page will
  // put there, so the name wraps the same way now as it will then.
  useSetPageTitle("הזמנה", preview.customerDisplayName, HEADER_MENU_PLACEHOLDER);

  return (
    <OrderPageSkeleton
      routeLoading={routeLoading}
      heading={
        <OrderPageHeading
          customerId={preview.customerId}
          customerName={preview.customerName}
          customerDisplayName={preview.customerDisplayName}
          actions={<ActionsSkeleton />}
        />
      }
    />
  );
}
