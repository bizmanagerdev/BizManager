import AppShell from "@/components/layout/AppShell";
import OrderPageLoading from "@/app/(app)/sales/orders/[id]/OrderPageLoading";

// Streamed instantly while this order's data loads, so TTFB = time-to-shell,
// not time-to-all-queries. Opened from the orders list, it already names the
// order.
export default function OrderDetailLoading() {
  return (
    <AppShell>
      <OrderPageLoading />
    </AppShell>
  );
}
