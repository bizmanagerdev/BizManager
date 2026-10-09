"use client";

import { useSearchParams } from "next/navigation";
import { SalesTabSkeleton } from "@/app/(app)/sales/SalesSkeleton";
import { buttonVariants } from "@/components/ui/button";
import { WarehouseIcon } from "@/components/ui/icons";
import { DELIVERY_REGIONS } from "@/lib/ui/cities";
import { cn } from "@/lib/utils";

// The delivery run before its data. It is the same queue as the sales page's
// deliveries tab (SalesDeliveriesQueue), so it is that tab's placeholder — the
// md+ region pills, the region table from xl, the stop cards below it — with
// one difference: here the pills stay on the page on a phone too (no header
// strip), the picking-list button beside them, so that row is drawn for a
// phone as well. For the route's loading screen.
export default function DeliveriesSkeleton() {
  const region = useSearchParams()?.get("region") ?? null;
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="flex flex-wrap items-center gap-2 md:hidden">
        {["הכל", ...DELIVERY_REGIONS].map((label) => {
          const active = label === "הכל" ? !region : region === label;
          return (
            <span
              key={label}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"
              )}
            >
              {label}
            </span>
          );
        })}
        <span className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-1.5")}>
          <WarehouseIcon className="h-4 w-4" />
          <span>רשימת ליקוט</span>
        </span>
      </div>
      <SalesTabSkeleton tab="deliveries" />
    </div>
  );
}
