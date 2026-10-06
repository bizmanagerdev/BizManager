import AppShell from "@/components/layout/AppShell";
import SalesSkeleton from "./SalesSkeleton";

// Streamed instantly while the sales page's server data loads (orders/products/
// deliveries counts + the active tab's first page), so TTFB no longer waits on
// the queries.
export default function SalesLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <SalesSkeleton />
      </div>
    </AppShell>
  );
}
