import AppShell from "@/components/layout/AppShell";
import AttendanceSkeleton, { AttendanceStripSkeleton } from "./AttendanceSkeleton";

// Streamed instantly while the phone/manual clock-in queue loads, so TTFB =
// time-to-shell. The queue's own shape (AttendanceSkeleton) — the phone strip
// held open with its filter and guide button in it, the summary band, the
// report cards — so the page lands without moving anything.
export default function PayrollAttendanceLoading() {
  return (
    <AppShell>
      <AttendanceStripSkeleton />
      <div className="space-y-4 text-right" dir="rtl" data-route-loading="true">
        <AttendanceSkeleton />
      </div>
    </AppShell>
  );
}
