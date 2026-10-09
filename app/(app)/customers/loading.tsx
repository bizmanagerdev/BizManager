import AppShell from "@/components/layout/AppShell";
import CustomersLoadingBody from "@/app/(app)/customers/CustomersLoadingBody";

// Streamed instantly while the page's data loads, so TTFB = time-to-shell, not
// time-to-all-queries. Renders the real AppShell (nav resolves from cached role)
// and the list's own shape (CustomersSkeleton — the phone strip's search row,
// the lg+ toolbar, the table from xl and the cards below it) to keep the swap
// shift-free; on the way to a customer's page, that page's shape instead.
export default function CustomersLoading() {
  return (
    <AppShell>
      <CustomersLoadingBody />
    </AppShell>
  );
}
