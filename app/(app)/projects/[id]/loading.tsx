import AppShell from "@/components/layout/AppShell";
import { DetailPageSkeleton } from "@/components/layout/DetailPageSkeleton";

// Streamed instantly while this project's data loads (six parallel read
// chains keyed off the id), so TTFB = time-to-shell, not time-to-all-queries.
export default function ProjectDetailLoading() {
  return (
    <AppShell>
      <DetailPageSkeleton />
    </AppShell>
  );
}
