import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared skeleton for "detail card" routes (customer/order/project/vehicle/
 * property/loan/worker pages) — a breadcrumb + title, a row of stat cards, and
 * a couple of larger content blocks. Used by each route's own `loading.tsx` so
 * TTFB = time-to-shell instead of time-to-all-queries (these pages chain many
 * independent reads keyed off the entity id).
 */
export function DetailPageSkeleton() {
  return (
    <div className="space-y-3 md:space-y-5" data-route-loading="true">
      <div className="space-y-1">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-6 w-56" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-2 py-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-28" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />
      </div>
    </div>
  );
}
