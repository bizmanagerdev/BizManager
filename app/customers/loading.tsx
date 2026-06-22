import AppShell from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Streamed instantly while the page's data loads, so TTFB = time-to-shell, not
// time-to-all-queries. Renders the real AppShell (nav resolves from cached role)
// and a list skeleton that mirrors the customers layout to keep the swap shift-free.
export default function CustomersLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-28" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-8 w-20" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
