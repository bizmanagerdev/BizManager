import AppShell from "@/components/layout/AppShell";
import CalendarSkeleton from "./CalendarSkeleton";

// Streamed instantly while this month's schedule entries load, so TTFB =
// time-to-shell. The calendar's own frame (CalendarSkeleton): this month's
// grid already drawn — dates, Hebrew dates, holidays, today — the phone's
// selected-day row and, from lg, the day panel beside it; only the items are
// blanks, so nothing moves when they land.
export default function CalendarLoading() {
  return (
    <AppShell>
      <div className="space-y-5" data-route-loading="true">
        <CalendarSkeleton />
      </div>
    </AppShell>
  );
}
