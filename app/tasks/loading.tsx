import AppShell from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Streamed instantly while the board's data loads, so TTFB = time-to-shell.
// Mirrors the Trello-style status columns to keep the fallback→content swap calm.
export default function TasksLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <div className="flex gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-28" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, col) => (
            <div key={col} className="space-y-3">
              <Skeleton className="h-6 w-24" />
              {Array.from({ length: 3 }).map((_, c) => (
                <Card key={c} className="p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-1/2" />
                </Card>
              ))}
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
