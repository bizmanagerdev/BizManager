import AppShell from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Streamed instantly while the phone/manual clock-in queue loads, so TTFB =
// time-to-shell. Mirrors the pending-reports queue list to keep the swap
// shift-free.
export default function PayrollAttendanceLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <Skeleton className="h-7 w-48" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
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
