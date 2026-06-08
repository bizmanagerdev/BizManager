import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchOrderDueDates } from "@/lib/collections";

type Row = Record<string, unknown>;

export const ORDERS_PAGE_SIZE = 50;

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

const ORDER_SELECT =
  "order_id,customer_id,customer_name,customer_name_for_invoice,customer_email,customer_phone,customer_city,customer_address,order_date,created_at,status,payment_status,total_amount,total_paid,remaining_balance,pending_amount,overdue_amount,payment_count,needs_invoice,invoice_sent_at,delivery_confirmed_at";

export type OrdersTab = "orders" | "closed";
export type OrdersPaymentFilter = "" | "paid" | "partial" | "unpaid";
export type OrdersInvoiceFilter = "" | "needs" | "no" | "pending" | "sent";

export type OrdersFilters = {
  tab: OrdersTab;
  customerId: string | null;
  q: string;
  paymentStatus: OrdersPaymentFilter;
  invoice: OrdersInvoiceFilter;
};

export type OrdersPageResult = {
  rows: Row[];
  totalCount: number;
  hasMore: boolean;
  error: string | null;
};

/**
 * For a set of (open) order ids, return those that contain at least one line item
 * whose product is currently oversold — i.e. available (on_hand - reserved) < 0.
 * Backorders are allowed, so a negative available is how we flag "this order
 * contains out-of-stock items".
 */
async function computeOutOfStockOrderIds(
  supabase: SupabaseClient,
  openOrderIds: string[]
): Promise<Set<string>> {
  if (openOrderIds.length === 0) return new Set();

  const { data: items } = await supabase
    .from("order_items")
    .select("order_id,product_id,quantity_ordered")
    .in("order_id", openOrderIds);
  const itemRows = (items ?? []) as Row[];

  const productIds = Array.from(
    new Set(
      itemRows
        .map((r) => (typeof r.product_id === "string" ? r.product_id : null))
        .filter((v): v is string => Boolean(v))
    )
  );
  if (productIds.length === 0) return new Set();

  const { data: inv } = await supabase
    .from("inventory")
    .select("product_id,quantity_on_hand,quantity_reserved")
    .in("product_id", productIds);

  const availableByProduct = new Map<string, number>();
  for (const r of (inv ?? []) as Row[]) {
    const pid = typeof r.product_id === "string" ? r.product_id : null;
    if (!pid) continue;
    const onHand = Number(r.quantity_on_hand ?? 0) || 0;
    const reserved = Number(r.quantity_reserved ?? 0) || 0;
    availableByProduct.set(pid, onHand - reserved);
  }

  const oos = new Set<string>();
  for (const it of itemRows) {
    const pid = typeof it.product_id === "string" ? it.product_id : null;
    const orderId = typeof it.order_id === "string" ? it.order_id : null;
    if (!pid || !orderId) continue;
    const avail = availableByProduct.get(pid);
    if (avail !== undefined && avail < 0) oos.add(orderId);
  }
  return oos;
}

/**
 * Load one page of the orders list (open or closed), with each order's effective
 * due date attached for the late-status badge. Shared by the initial server
 * render (page 1) and the fetch-on-scroll server action (page >= 2).
 */
export async function loadOrdersPage(
  supabase: SupabaseClient,
  { page, filters }: { page: number; filters: OrdersFilters }
): Promise<OrdersPageResult> {
  const { tab, customerId, q, paymentStatus, invoice } = filters;
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const from = (safePage - 1) * ORDERS_PAGE_SIZE;
  const to = safePage * ORDERS_PAGE_SIZE - 1;

  let ordersQuery =
    tab === "orders"
      ? supabase
          .from("order_overview_view")
          .select(ORDER_SELECT, { count: "estimated" })
          .not("status", "in", `(${CLOSED_ORDER_STATUSES.join(",")})`)
          .order("order_date", { ascending: false })
      : supabase
          .from("order_overview_view")
          .select(ORDER_SELECT, { count: "estimated" })
          .order("order_date", { ascending: false });

  if (customerId) ordersQuery = ordersQuery.eq("customer_id", customerId);
  if (invoice === "needs") {
    ordersQuery = ordersQuery.eq("needs_invoice", true);
  } else if (invoice === "no") {
    ordersQuery = ordersQuery.eq("needs_invoice", false);
  } else if (invoice === "pending") {
    ordersQuery = ordersQuery.eq("needs_invoice", true).is("invoice_sent_at", null);
  } else if (invoice === "sent") {
    ordersQuery = ordersQuery.not("invoice_sent_at", "is", null);
  }
  if (tab === "closed") {
    ordersQuery = ordersQuery.in("status", CLOSED_ORDER_STATUSES);
    if (paymentStatus === "paid") {
      ordersQuery = ordersQuery.gt("total_paid", 0).lte("remaining_balance", 0.009);
    } else if (paymentStatus === "partial") {
      ordersQuery = ordersQuery.gt("total_paid", 0).gt("remaining_balance", 0.009);
    } else if (paymentStatus === "unpaid") {
      ordersQuery = ordersQuery.lte("total_paid", 0);
    }
  }
  if (q) {
    const escaped = q.replace(/[%,]/g, " ");
    // Search customers by name and invoice name to get matching customer IDs.
    const { data: matchingCustomers } = await supabase
      .from("customers")
      .select("id")
      .or(`name.ilike.%${escaped}%,name_for_invoice.ilike.%${escaped}%`)
      .limit(300);
    const matchedCustomerIds = ((matchingCustomers ?? []) as Row[])
      .map((c) => (typeof c.id === "string" ? c.id : null))
      .filter((id): id is string => id !== null);

    const conditions: string[] = [
      `customer_phone.ilike.%${escaped}%`,
      `customer_email.ilike.%${escaped}%`,
      `customer_city.ilike.%${escaped}%`,
    ];
    if (matchedCustomerIds.length > 0) {
      conditions.push(`customer_id.in.(${matchedCustomerIds.join(",")})`);
    }
    ordersQuery = ordersQuery.or(conditions.join(","));
  }

  const { data, error, count } = await ordersQuery.range(from, to);
  const rows = (data ?? []) as Row[];

  const orderDueById = await fetchOrderDueDates(
    supabase,
    rows.map((r) => (typeof r.order_id === "string" ? r.order_id : "")).filter(Boolean)
  );
  // Flag orders that contain out-of-stock (oversold) items. Only open orders
  // reserve stock, so closed/delivered/cancelled orders are never flagged.
  const openOrderIds = rows
    .filter((r) => !CLOSED_ORDER_STATUSES.includes(String(r.status ?? "").toLowerCase()))
    .map((r) => (typeof r.order_id === "string" ? r.order_id : ""))
    .filter(Boolean);
  const outOfStockIds = await computeOutOfStockOrderIds(supabase, openOrderIds);

  const rowsWithDue = rows.map((r) => ({
    ...r,
    due_date: orderDueById.get(typeof r.order_id === "string" ? r.order_id : "")?.dueDate ?? null,
    out_of_stock: outOfStockIds.has(typeof r.order_id === "string" ? r.order_id : ""),
  }));

  const totalCount = typeof count === "number" ? count : rows.length;
  // Drive "has more" off page fullness, not the estimated count.
  const hasMore = rows.length === ORDERS_PAGE_SIZE;

  return { rows: rowsWithDue, totalCount, hasMore, error: error?.message ?? null };
}
