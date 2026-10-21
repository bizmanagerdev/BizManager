import AppShell from "@/components/layout/AppShell";
import RentRollSkeleton from "@/app/(app)/rent/RentRollSkeleton";

// Streamed instantly while the rent roll loads, so TTFB = time-to-shell. The
// roll's own shape (RentRollSkeleton) keeps the swap shift-free.
export default function RentRollLoading() {
  return (
    <AppShell>
      <div data-route-loading="true">
        <RentRollSkeleton />
      </div>
    </AppShell>
  );
}
