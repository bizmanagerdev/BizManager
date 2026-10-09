import AppShell from "@/components/layout/AppShell";
import DeliveriesSkeleton from "./DeliveriesSkeleton";

// Streamed instantly while the delivery queue loads, so TTFB = time-to-shell.
// The queue's own shape (DeliveriesSkeleton) — the region pills, the region
// table from xl, the stop cards below it — to keep the swap shift-free.
// (The page itself renders no <AppShell> — it relies on app/(app)/layout.tsx
// for chrome — but wrapping here matches every other route's loading.tsx and
// is a no-op passthrough once nested under the real shell.)
export default function DeliveriesLoading() {
  return (
    <AppShell>
      <div className="space-y-4" dir="rtl" data-route-loading="true">
        <DeliveriesSkeleton />
      </div>
    </AppShell>
  );
}
