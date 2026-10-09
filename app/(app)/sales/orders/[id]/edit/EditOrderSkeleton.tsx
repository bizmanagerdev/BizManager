"use client";

import { useParams } from "next/navigation";
import OrderFormSkeleton from "@/app/(app)/sales/orders/new/OrderFormSkeleton";

// An order's edit page before it arrives: its heading, then the order form at
// its first step (OrderFormSkeleton), its ביטול back to the order. `id`: for
// the sales page's own loading screen, which the router can show on the way
// here (it has no [id] param of its own).
export default function EditOrderSkeleton({ id: idProp }: { id?: string } = {}) {
  const params = useParams<{ id: string }>();
  const id = idProp ?? (typeof params?.id === "string" ? params.id : "");
  return (
    <div className="space-y-4" data-route-loading="true">
      <div>
        <h1 className="text-2xl font-semibold">עריכת הזמנה</h1>
        <p className="text-sm text-muted-foreground">עדכון לקוח, מוצרים ותשלום להזמנה קיימת.</p>
      </div>
      <OrderFormSkeleton cancelHref={id ? `/sales/orders/${id}` : "/sales"} />
    </div>
  );
}
