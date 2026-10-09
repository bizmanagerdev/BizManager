import AppShell from "@/components/layout/AppShell";
import CustomerPageSkeleton from "@/app/(app)/customers/[id]/CustomerPageSkeleton";

// Streamed instantly while this customer's data loads (several independent
// reads keyed off the id), so TTFB = time-to-shell, not time-to-all-queries.
// The page's own shape (CustomerPageSkeleton): its heading, its two columns
// and their sections, so the page lands without moving.
export default function CustomerDetailLoading() {
  return (
    <AppShell>
      <CustomerPageSkeleton routeLoading />
    </AppShell>
  );
}
