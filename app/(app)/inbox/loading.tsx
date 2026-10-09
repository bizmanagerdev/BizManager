import AppShell from "@/components/layout/AppShell";
import InboxSkeleton from "./InboxSkeleton";

// Streamed instantly while the inbox view (everything still open for this
// viewer) loads, so TTFB = time-to-shell. The inbox's own shape
// (InboxSkeleton) — heading and buttons, category chips, the reminder cards —
// to keep the swap shift-free.
export default function InboxLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <InboxSkeleton />
      </div>
    </AppShell>
  );
}
