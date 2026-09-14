import AppShell from "@/components/layout/AppShell";
import { DetailPageSkeleton } from "@/components/layout/DetailPageSkeleton";

// Streamed instantly while this profile's data loads (sessions, agreements,
// payslips, bonuses, payroll totals — several independent reads keyed off the
// viewer's own id), so TTFB = time-to-shell.
export default function ProfileLoading() {
  return (
    <AppShell>
      <DetailPageSkeleton />
    </AppShell>
  );
}
