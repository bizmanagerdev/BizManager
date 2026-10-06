import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrdersPaymentFilter } from "./loadOrders";

export type SalesTabCounts = {
  orders: number;
  closed: number;
  inventory: number;
  "price-list": number;
  deliveries: number;
};

const CLOSED_ORDER_STATUSES = [
  "delivered",
  "completed",
  "closed",
  "cancelled",
  "סופקה",
  "הושלמה",
  "סגורה",
  "בוטלה",
];

/**
 * The /sales tab bar's counts: open orders, closed orders (narrowed by the
 * closed tab's payment filter), products, open deliveries — for one customer
 * when the page is for one. The server page and its device version
 * (LocalSalesPage) count the same way.
 */
export async function loadSalesTabCounts(
  supabase: SupabaseClient,
  { customerId, paymentStatus }: { customerId: string | null; paymentStatus: OrdersPaymentFilter }
): Promise<SalesTabCounts> {
  const [{ count: openOrdersCount }, { count: closedOrdersCount }, { count: productsCount }, { count: deliveriesCount }] =
    await Promise.all([
      (() => {
        // Tab count — only needs status/customer_id, so it counts the plain
        // orders table rather than order_overview_view (which forces a
        // total_paid/remaining_balance aggregation per count).
        let query = supabase
          .from("orders")
          .select("id", { count: "estimated", head: true })
          .not("status", "in", `(${CLOSED_ORDER_STATUSES.join(",")})`);
        if (customerId) query = query.eq("customer_id", customerId);
        return query;
      })(),
      (() => {
        if (paymentStatus) {
          // Payment-status filter genuinely needs the view's computed
          // total_paid/remaining_balance columns.
          let query = supabase
            .from("order_overview_view")
            .select("order_id", { count: "estimated", head: true })
            .in("status", CLOSED_ORDER_STATUSES);
          if (customerId) query = query.eq("customer_id", customerId);
          if (paymentStatus === "paid") {
            query = query.gt("total_paid", 0).lte("remaining_balance", 0.009);
          } else if (paymentStatus === "partial") {
            query = query.gt("total_paid", 0).gt("remaining_balance", 0.009);
          } else if (paymentStatus === "unpaid") {
            query = query.lte("total_paid", 0);
          }
          return query;
        }
        // No payment-status filter — only needs status/customer_id, so count
        // the plain orders table rather than order_overview_view (which forces
        // a total_paid/remaining_balance aggregation per count).
        let query = supabase
          .from("orders")
          .select("id", { count: "estimated", head: true })
          .in("status", CLOSED_ORDER_STATUSES);
        if (customerId) query = query.eq("customer_id", customerId);
        return query;
      })(),
      supabase.from("products").select("id", { count: "estimated", head: true }),
      (() => {
        let query = supabase
          .from("delivery_overview_view")
          .select("order_id,status", { count: "estimated", head: true })
          .not("status", "in", `(${CLOSED_ORDER_STATUSES.join(",")})`);
        if (customerId) query = query.eq("customer_id", customerId);
        return query;
      })(),
    ]);

  return {
    orders: typeof openOrdersCount === "number" ? openOrdersCount : 0,
    closed: typeof closedOrdersCount === "number" ? closedOrdersCount : 0,
    inventory: typeof productsCount === "number" ? productsCount : 0,
    "price-list": typeof productsCount === "number" ? productsCount : 0,
    deliveries: typeof deliveriesCount === "number" ? deliveriesCount : 0,
  };
}
