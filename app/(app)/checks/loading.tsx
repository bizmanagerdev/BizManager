import AppShell from "@/components/layout/AppShell";
import ChecksSkeleton from "./ChecksSkeleton";

// Streamed instantly while the checks register loads, so TTFB = time-to-shell.
// The register's own shape (ChecksSkeleton) — summary cards, filter row, the
// table from sm / cards below — to keep the swap shift-free.
export default function ChecksLoading() {
  return (
    <AppShell>
      <div className="space-y-4 text-right" dir="rtl" data-route-loading="true">
        <ChecksSkeleton />
      </div>
    </AppShell>
  );
}
