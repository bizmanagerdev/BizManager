import AppShell from "@/components/layout/AppShell";
import { DetailPageSkeleton } from "@/components/layout/DetailPageSkeleton";

// Streamed instantly while this property's data loads, so TTFB = time-to-shell,
// not time-to-all-queries.
export default function PropertyDetailLoading() {
  return (
    <AppShell>
      <DetailPageSkeleton />
    </AppShell>
  );
}
