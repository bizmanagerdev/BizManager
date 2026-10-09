import AppShell from "@/components/layout/AppShell";
import PaymentsCalendarSkeleton from "./PaymentsCalendarSkeleton";

// Streamed instantly while the scheduled money loads, so TTFB = time-to-shell.
// The page's own shape (it used to get the cash-flow page's title and tiles):
// the tabs, direction switch and filters, then the month's calendar with the
// day panel — or the recurring list — inside the page's own wrapper, so the
// gaps match.
export default function PaymentsCalendarLoading() {
  return (
    <AppShell>
      <div className="space-y-5" data-route-loading="true">
        <PaymentsCalendarSkeleton />
      </div>
    </AppShell>
  );
}
