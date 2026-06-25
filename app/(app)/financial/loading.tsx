import AppShell from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Streamed instantly while the (heavy) cash-flow data loads, so TTFB = time-to-shell.
// Mirrors the header + summary cards + entries list to keep the swap shift-free.
export default function FinancialLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-[1.5rem]" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-24" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
