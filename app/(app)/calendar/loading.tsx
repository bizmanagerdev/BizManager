import AppShell from "@/components/layout/AppShell";
import { Skeleton } from "@/components/ui/skeleton";

// Streamed instantly while this month's schedule entries load, so TTFB =
// time-to-shell. The real page is a full-screen month grid — a single
// pulsing block stands in rather than reproducing every cell.
export default function CalendarLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <Skeleton className="h-7 w-40" />
        <div className="h-[70vh] w-full animate-pulse rounded-2xl border bg-muted/40" />
      </div>
    </AppShell>
  );
}
