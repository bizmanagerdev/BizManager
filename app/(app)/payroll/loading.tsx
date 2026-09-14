import AppShell from "@/components/layout/AppShell";
import { DetailPageSkeleton } from "@/components/layout/DetailPageSkeleton";

// Streamed instantly while loadPayrollPageData() runs (users, sessions, periods
// and options loaded before the page can render), so TTFB = time-to-shell.
// Uses the same DetailPageSkeleton the page's own dynamic(SalaryCenterClient)
// import falls back to, so there's no visual jump handing off between the two.
export default function PayrollLoading() {
  return (
    <AppShell>
      <DetailPageSkeleton />
    </AppShell>
  );
}
