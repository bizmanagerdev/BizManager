import AppShell from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Streamed instantly while the audit feed + presence roster load, so TTFB =
// time-to-shell. Mirrors the filter row + feed list to keep the swap
// shift-free.
export default function ActivityLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <Skeleton className="h-16 w-full rounded-2xl" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-32" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-20" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
