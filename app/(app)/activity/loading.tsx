import AppShell from "@/components/layout/AppShell";
import ActivitySkeleton, { ActivityStripSkeleton } from "./ActivitySkeleton";

// Streamed instantly while the feed, the people and today's numbers load, so
// TTFB = time-to-shell. The page's own shape (ActivitySkeleton) — "היום בעסק",
// "מי עובד עכשיו", the feed — with the phone strip held open with its search
// field and filter button, so nothing moves when the page arrives.
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
