import AppShell from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Streamed instantly while the vehicles list loads, so TTFB = time-to-shell.
// Mirrors the toolbar + vehicle card list to keep the swap shift-free.
export default function VehiclesLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-10 w-full max-w-xs" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-2 h-8 w-full" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
