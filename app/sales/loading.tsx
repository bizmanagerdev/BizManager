import AppShell from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Streamed instantly while the sales page's server data loads (orders/products/
// deliveries counts + the active tab's first page), so TTFB no longer waits on
// the queries. Mirrors the real layout (header row, tabs nav, list rows) to keep
// the fallback→content swap from shifting the page (CLS).
export default function SalesLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        {/* Header row: "new order" button */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Skeleton className="h-11 w-full sm:ms-auto sm:h-10 sm:w-36" />
        </div>

        {/* Tabs nav */}
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 shrink-0" />
          ))}
        </div>

        {/* List rows */}
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-20" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
