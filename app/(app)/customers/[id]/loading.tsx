import AppShell from "@/components/layout/AppShell";
import CustomerPageSkeleton from "@/app/(app)/customers/[id]/CustomerPageSkeleton";

// Streamed instantly while this customer's data loads, so TTFB = time-to-shell,
// not time-to-all-queries. The page's own shape (CustomerPageSkeleton): the top
// bar's "לקוח" and ⋮, the two cards and every section's header, so the page
// lands without moving.
export default function CustomerDetailLoading() {
  return (
    <AppShell>
      <CustomerPageSkeleton routeLoading />
    </AppShell>
  );
}
