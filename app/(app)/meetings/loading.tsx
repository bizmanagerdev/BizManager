import AppShell from "@/components/layout/AppShell";
import MeetingsLoadingBody from "./MeetingsLoadingBody";

// Streamed instantly while the meeting (its items, the week's numbers, last
// week's tasks) loads, so TTFB = time-to-shell — the page had no loading
// screen, so a tap on it showed nothing until all of it was in. The meeting's
// own shape (MeetingSkeleton); on the way to the history or a past meeting,
// that page's own (MeetingsLoadingBody).
export default function MeetingsLoading() {
  return (
    <AppShell>
      <MeetingsLoadingBody />
    </AppShell>
  );
}
