import AppShell from "@/components/layout/AppShell";
import SalesSkeleton from "./SalesSkeleton";
import SalesLoadingStrip from "./SalesLoadingStrip";

// Streamed instantly while the sales page's server data loads (orders/products/
// deliveries counts + the active tab's first page), so TTFB no longer waits on
// the queries. The phone's header strip is held open, as every tab fills it.
export default function SalesLoading() {
  return (
    <AppShell>
      <SalesLoadingStrip />
      <div className="space-y-4" data-route-loading="true">
        <SalesSkeleton />
      </div>
    </AppShell>
  );
}
