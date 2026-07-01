import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchOrderDueDates } from "@/lib/collections";
import { findMatchingCustomers } from "@/lib/search/findMatchingCustomers";
import { findOrderIdsMatchingContent } from "@/lib/search/findMatchingChildIds";

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

export type OrderProductSummary = { name: string; quantity: number };

/**
 * For a set of order ids, return a compact per-order product list
 * (product name + ordered quantity) so the list view can show what's in each
 * order without opening it. Ordered by line position for stable display.
 */
async function fetchOrderProductSummaries(
  supabase: SupabaseClient,
  orderIds: string[]
): Promise<Map<string, OrderProductSummary[]>> {
  const result = new Map<string, OrderProductSummary[]>();
  if (orderIds.length === 0) return result;

  const { data: items } = await supabase
    .from("order_items")
    .select("id,order_id,product_id,quantity_ordered")
    .in("order_id", orderIds)
    .order("id", { ascending: true });
  const itemRows = (items ?? []) as Row[];
  if (itemRows.length === 0) return result;

  const productIds = Array.from(
    new Set(
      itemRows
        .map((r) => (typeof r.product_id === "string" ? r.product_id : null))
        .filter((v): v is string => Boolean(v))
    )
  );

  const nameByProduct = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: products } = await supabase
      .from("products")
      .select("id,name")
      .in("id", productIds);
    for (const p of (products ?? []) as Row[]) {
      const pid = typeof p.id === "string" ? p.id : null;
      const name = typeof p.name === "string" ? p.name : null;
      if (pid && name) nameByProduct.set(pid, name);
    }
  }

  for (const it of itemRows) {
    const orderId = typeof it.order_id === "string" ? it.order_id : null;
    if (!orderId) continue;
    const pid = typeof it.product_id === "string" ? it.product_id : null;
    const name = (pid && nameByProduct.get(pid)) || "פריט";
    const quantity = Number(it.quantity_ordered ?? 0) || 0;
    const list = result.get(orderId) ?? [];
    list.push({ name, quantity });
    result.set(orderId, list);
  }
  return result;
}

/**
 * For a set of order ids, return each order's PENDING (not-yet-collected) payment
 * methods + first pending check number. Lets the list flag "this expected payment
 * is a check" so you know not to chase cash.
 */
async function fetchOrderPendingMethods(
  supabase: SupabaseClient,
  orderIds: string[]
): Promise<Map<string, { methods: string[]; checkNumber: string | null }>> {
  const result = new Map<string, { methods: string[]; checkNumber: string | null }>();
  if (orderIds.length === 0) return result;

  const { data } = await supabase
    .from("payments")
    .select("order_id,payment_method,check_number,payment_status")
    .in("order_id", orderIds)
    .eq("payment_status", "pending");

  for (const row of (data ?? []) as Row[]) {
    const orderId = typeof row.order_id === "string" ? row.order_id : "";
    if (!orderId) continue;
    const method = typeof row.payment_method === "string" ? row.payment_method : null;
    const checkNumber = typeof row.check_number === "string" ? row.check_number : null;
    const entry = result.get(orderId) ?? { methods: [], checkNumber: null };
    if (method && !entry.methods.includes(method)) entry.methods.push(method);
    if (!entry.checkNumber && checkNumber) entry.checkNumber = checkNumber;
    result.set(orderId, entry);
  }
  return result;
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
    // Resolve matching customers with the shared matcher (fuzzy names,
    // phone↔whatsapp cross-match), and matching order line items (product
    // name/SKU/barcode or line note), then match orders by their IDs. The order
    // snapshot fields stay in the OR so an order keeps matching even after the
    // customer record changes.
    const [{ customerIds }, orderContent] = await Promise.all([
      findMatchingCustomers(supabase, q, { limit: 300, idsOnly: true }),
      findOrderIdsMatchingContent(supabase, q, 300),
    ]);
    const itemOrderIds = orderContent.ids;

    // The order's own snapshot fields (name/invoice-name/address/city/phone/email)
    // plus its status, so "find anything on the order" works from the list too.
    const conditions: string[] = [
      `customer_name.ilike.%${escaped}%`,
      `customer_name_for_invoice.ilike.%${escaped}%`,
      `customer_phone.ilike.%${escaped}%`,
      `customer_email.ilike.%${escaped}%`,
      `customer_city.ilike.%${escaped}%`,
      `customer_address.ilike.%${escaped}%`,
      `status.ilike.%${escaped}%`,
    ];
    if (customerIds.length > 0) {
      conditions.push(`customer_id.in.(${customerIds.join(",")})`);
    }
    if (itemOrderIds.length > 0) {
      conditions.push(`order_id.in.(${itemOrderIds.join(",")})`);
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

  const allOrderIds = rows
    .map((r) => (typeof r.order_id === "string" ? r.order_id : ""))
    .filter(Boolean);
  const [productsByOrder, pendingMethodsByOrder] = await Promise.all([
    fetchOrderProductSummaries(supabase, allOrderIds),
    fetchOrderPendingMethods(supabase, allOrderIds),
  ]);

  const rowsWithDue = rows.map((r) => {
    const orderId = typeof r.order_id === "string" ? r.order_id : "";
    const pending = pendingMethodsByOrder.get(orderId);
    return {
      ...r,
      due_date: orderDueById.get(orderId)?.dueDate ?? null,
      out_of_stock: outOfStockIds.has(orderId),
      products: productsByOrder.get(orderId) ?? [],
      pending_payment_methods: pending?.methods ?? [],
      pending_check_number: pending?.checkNumber ?? null,
    };
  });

  const totalCount = typeof count === "number" ? count : rows.length;
  // Drive "has more" off page fullness, not the estimated count.
  const hasMore = rows.length === ORDERS_PAGE_SIZE;

  return { rows: rowsWithDue, totalCount, hasMore, error: error?.message ?? null };
}
