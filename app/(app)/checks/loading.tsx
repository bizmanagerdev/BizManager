import AppShell from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Streamed instantly while the checks register loads, so TTFB = time-to-shell.
// Mirrors the check row list to keep the swap shift-free.
export default function ChecksLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <Skeleton className="h-10 w-full max-w-xs" />
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
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
