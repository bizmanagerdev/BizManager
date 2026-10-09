import AppShell from "@/components/layout/AppShell";
import { MeetingsHistorySkeleton } from "../MeetingSkeleton";

// Streamed instantly while the meetings and their tallies load, so TTFB =
// time-to-shell. The history's own shape — its heading and the list of
// meetings — instead of the live meeting's placeholder it would otherwise
// inherit from /meetings.
export default function MeetingsHistoryLoading() {
  return (
    <AppShell>
      <div data-route-loading="true">
        <MeetingsHistorySkeleton />
      </div>
    </AppShell>
  );
}
