import AppShell from "@/components/layout/AppShell";
import SalesLoadingBody from "./SalesLoadingBody";
import SalesLoadingStrip from "./SalesLoadingStrip";

// Streamed instantly while the sales page's server data loads (orders/products/
// deliveries counts + the active tab's first page), so TTFB no longer waits on
// the queries. The phone's header strip is held open, as every tab fills it —
// and on the way to a page under /sales, that page's own loading screen
// (SalesLoadingBody).
export default function SalesLoading() {
  return (
    <AppShell>
      <SalesLoadingStrip />
      <SalesLoadingBody />
    </AppShell>
  );
}
