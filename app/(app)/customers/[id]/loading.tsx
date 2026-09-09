import AppShell from "@/components/layout/AppShell";
import { DetailPageSkeleton } from "@/components/layout/DetailPageSkeleton";

// Streamed instantly while this customer's data loads (several independent
// reads keyed off the id), so TTFB = time-to-shell, not time-to-all-queries.
export default function CustomerDetailLoading() {
  return (
    <AppShell>
      <DetailPageSkeleton />
    </AppShell>
  );
}
