import AppShell from "@/components/layout/AppShell";
import CollectionsSkeleton from "./CollectionsSkeleton";

// Streamed instantly while the collections data (debtor totals + payments due
// today) loads, so TTFB = time-to-shell. The page's own shape
// (CollectionsSkeleton) — its tabs, totals line, toolbar and the table from sm
// / cards below — to keep the swap shift-free.
export default function CollectionsLoading() {
  return (
    <AppShell>
      <div className="space-y-4 text-right" dir="rtl" data-route-loading="true">
        <CollectionsSkeleton />
      </div>
    </AppShell>
  );
}
