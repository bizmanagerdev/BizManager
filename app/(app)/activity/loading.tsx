import AppShell from "@/components/layout/AppShell";
import ActivitySkeleton, { ActivityStripSkeleton } from "./ActivitySkeleton";

// Streamed instantly while the audit feed + presence roster load, so TTFB =
// time-to-shell. The page's own shape (ActivitySkeleton) — the users card, the
// filter row, the feed's table / cards — with the phone strip held open with
// its live indicator and filter button, so nothing moves when the page arrives.
export default function ActivityLoading() {
  return (
    <AppShell>
      <ActivityStripSkeleton />
      <div className="space-y-4" data-route-loading="true">
        <ActivitySkeleton />
      </div>
    </AppShell>
  );
}
