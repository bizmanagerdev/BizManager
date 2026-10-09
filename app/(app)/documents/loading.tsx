import AppShell from "@/components/layout/AppShell";
import DocumentsSkeleton from "./DocumentsSkeleton";

// Streamed instantly while the archive's data loads (documents + every linked
// project/property/task/customer/order lookup), so TTFB = time-to-shell. The
// archive's own shape (DocumentsSkeleton) — search row, filter row, the trays
// of document cards — to keep the swap shift-free.
export default function DocumentsLoading() {
  return (
    <AppShell>
      <div data-route-loading="true">
        <DocumentsSkeleton />
      </div>
    </AppShell>
  );
}
