import AppShell from "@/components/layout/AppShell";
import PayrollLoadingBody from "./PayrollLoadingBody";

// Streamed instantly while loadPayrollPageData() runs (users, sessions, periods
// and options loaded before the page can render), so TTFB = time-to-shell.
// The salary center's own shape (PayrollSkeleton) — the same placeholder the
// page's dynamic(SalaryCenterClient) import falls back to, so the hand-off
// doesn't jump; on the way to the attendance queue or a worker's page, that
// page's own (PayrollLoadingBody).
export default function PayrollLoading() {
  return (
    <AppShell>
      <PayrollLoadingBody />
    </AppShell>
  );
}
