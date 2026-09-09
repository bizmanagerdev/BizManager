import AppShell from "@/components/layout/AppShell";
import { DetailPageSkeleton } from "@/components/layout/DetailPageSkeleton";

// Streamed instantly while this worker's payroll data loads, so TTFB =
// time-to-shell, not time-to-all-queries.
export default function WorkerDetailLoading() {
  return (
    <AppShell>
      <DetailPageSkeleton />
    </AppShell>
  );
}
