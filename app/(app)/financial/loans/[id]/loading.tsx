import AppShell from "@/components/layout/AppShell";
import LoanDetailSkeleton from "./LoanDetailSkeleton";

// Streamed instantly while this loan's data loads, so TTFB = time-to-shell,
// not time-to-all-queries. The loan page's own shape (LoanDetailSkeleton) —
// its heading line and its two sections — not the generic detail placeholder.
export default function LoanDetailLoading() {
  return (
    <AppShell>
      <LoanDetailSkeleton />
    </AppShell>
  );
}
