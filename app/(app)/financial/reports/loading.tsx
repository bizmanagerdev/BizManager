import AppShell from "@/components/layout/AppShell";
import { ReportsSkeleton } from "@/app/(app)/financial/FinancialSkeleton";

// Streamed instantly while the reports' data loads, so TTFB = time-to-shell.
// The reports view's own shape (it used to get the cash-flow ledger's): the
// global filter band, the report tabs and the overview tab's cards.
export default function FinancialReportsLoading() {
  return (
    <AppShell>
      <ReportsSkeleton routeLoading />
    </AppShell>
  );
}
