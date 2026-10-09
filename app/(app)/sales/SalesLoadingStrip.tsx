"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { SalesStripSkeleton } from "./SalesSkeleton";

// Every sales tab has its search / filters in the phone's header strip, so the
// sales loading screen holds that strip open — with the open tab's controls'
// shape in it — and the tab arriving then doesn't push the page down. Only on
// /sales itself: this loading screen also shows on the way to the pages under
// it (a new order, an order's edit page), which have no strip.
export default function SalesLoadingStrip() {
  const pathname = usePathname();
  const tab = useSearchParams()?.get("tab");
  if (pathname !== "/sales") return null;
  return (
    <SalesStripSkeleton
      tab={tab === "closed" || tab === "inventory" || tab === "price-list" || tab === "deliveries" ? tab : "orders"}
    />
  );
}
