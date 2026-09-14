import AppShell from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Streamed instantly while the delivery queue loads, so TTFB = time-to-shell.
// Mirrors the region tabs + delivery card list to keep the swap shift-free.
// (The page itself renders no <AppShell> — it relies on app/(app)/layout.tsx
// for chrome — but wrapping here matches every other route's loading.tsx and
// is a no-op passthrough once nested under the real shell.)
export default function DeliveriesLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <Skeleton className="h-7 w-40" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-20" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
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
