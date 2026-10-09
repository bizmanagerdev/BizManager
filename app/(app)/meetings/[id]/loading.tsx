import AppShell from "@/components/layout/AppShell";
import { MeetingRecordSkeleton } from "../MeetingSkeleton";

// Streamed instantly while a past meeting (its items, numbers and tasks)
// loads, so TTFB = time-to-shell. The way back to the history over the
// meeting's own shape, read-only — no editing buttons, as the page shows it.
export default function MeetingRecordLoading() {
  return (
    <AppShell>
      <div data-route-loading="true">
        <MeetingRecordSkeleton />
      </div>
    </AppShell>
  );
}
