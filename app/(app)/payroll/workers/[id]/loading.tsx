import AppShell from "@/components/layout/AppShell";
import WorkerPageSkeleton from "./WorkerPageSkeleton";

// Streamed instantly while this worker's payroll data loads, so TTFB =
// time-to-shell, not time-to-all-queries. The worker page's own frame
// (WorkerPageSkeleton) — the same placeholder its dynamic(SalaryCenterClient)
// import falls back to.
export default function WorkerDetailLoading() {
  return (
    <AppShell>
      <div className="space-y-4 text-right" dir="rtl" data-route-loading="true">
        <WorkerPageSkeleton />
      </div>
    </AppShell>
  );
}
