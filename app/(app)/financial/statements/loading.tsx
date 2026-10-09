import AppShell from "@/components/layout/AppShell";
import StatementsSkeleton from "./StatementsSkeleton";

// Streamed instantly while the statements and the monthly card costs load, so
// TTFB = time-to-shell. The page's own shape (it used to get the cash-flow
// page's): its two tabs and links, the monthly card table. Inside the page's
// own wrapper, so the gaps match.
export default function StatementsLoading() {
  return (
    <AppShell>
      <div className="space-y-4 text-right" dir="rtl" data-route-loading="true" aria-busy="true">
        <StatementsSkeleton />
      </div>
    </AppShell>
  );
}
