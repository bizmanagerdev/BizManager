"use client";

import { usePathname } from "next/navigation";
import OrderPageLoading from "@/app/(app)/sales/orders/[id]/OrderPageLoading";
import EditOrderSkeleton from "@/app/(app)/sales/orders/[id]/edit/EditOrderSkeleton";
import OrderFormSkeleton from "@/app/(app)/sales/orders/new/OrderFormSkeleton";
import SalesSkeleton from "./SalesSkeleton";

// The sales page's loading screen is also what the router shows on the way
// from outside /sales to the pages under it (its boundary is the outer one),
// so it looks at the address: an order — that order's own loading screen; its
// edit page — the heading and the order form; a new order — the order form;
// the sales page itself — its tab bar and the open tab's shape.

const ORDER = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
const ORDER_PAGE = new RegExp(`^/sales/orders/${ORDER}$`, "i");
const EDIT_PAGE = new RegExp(`^/sales/orders/${ORDER}/edit$`, "i");

export default function SalesLoadingBody() {
  const pathname = usePathname() ?? "/sales";
  const orderId = ORDER_PAGE.exec(pathname)?.[1];
  if (orderId) return <OrderPageLoading id={orderId} />;
  const editId = EDIT_PAGE.exec(pathname)?.[1];
  if (editId) return <EditOrderSkeleton id={editId} />;
  if (pathname === "/sales/orders/new") {
    return (
      <div className="space-y-4" data-route-loading="true">
        <OrderFormSkeleton />
      </div>
    );
  }
  return (
    <div className="space-y-4" data-route-loading="true">
      <SalesSkeleton />
    </div>
  );
}
