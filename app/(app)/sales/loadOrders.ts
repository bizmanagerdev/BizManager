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
  "order_id,customer_id,branch_id,customer_branch_name,customer_name,customer_name_for_invoice,customer_email,customer_phone,customer_city,customer_address,order_date,created_at,status,payment_status,total_amount,total_paid,remaining_balance,pending_amount,overdue_amount,payment_count,needs_invoice,invoice_sent_at,delivery_confirmed_at,notes";

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

export type OrderProductSummary = { name: string; quantity: number; delivered: number };

/**
 * One read of order_items for the whole page, ordered by line position for stable
 * display. Both the per-order product summary and the out-of-stock flag are
 * derived from these same rows (previously two separate reads of the same table).
 */
async function fetchOrderItems(supabase: SupabaseClient, orderIds: string[]): Promise<Row[]> {
  if (orderIds.length === 0) return [];
  const { data } = await supabase
    .from("order_items")
    .select("id,order_id,product_id,quantity_ordered,quantity_delivered")
    .in("order_id", orderIds)
    .order("id", { ascending: true });
  return (data ?? []) as Row[];
}

/** available (on_hand − reserved) per product, for the out-of-stock flag. */
async function fetchInventoryAvailability(
  supabase: SupabaseClient,
  productIds: string[]
): Promise<Map<string, number>> {
  const availableByProduct = new Map<string, number>();
  if (productIds.length === 0) return availableByProduct;
  const { data: inv } = await supabase
    .from("inventory")
    .select("product_id,quantity_on_hand,quantity_reserved")
    .in("product_id", productIds);
  for (const r of (inv ?? []) as Row[]) {
    const pid = typeof r.product_id === "string" ? r.product_id : null;
    if (!pid) continue;
    const onHand = Number(r.quantity_on_hand ?? 0) || 0;
    const reserved = Number(r.quantity_reserved ?? 0) || 0;
    availableByProduct.set(pid, onHand - reserved);
  }
  return availableByProduct;
}

/** product id → display name. */
async function fetchProductNames(
  supabase: SupabaseClient,
  productIds: string[]
): Promise<Map<string, string>> {
  const nameByProduct = new Map<string, string>();
  if (productIds.length === 0) return nameByProduct;
  const { data: products } = await supabase.from("products").select("id,name").in("id", productIds);
  for (const p of (products ?? []) as Row[]) {
    const pid = typeof p.id === "string" ? p.id : null;
    const name = typeof p.name === "string" ? p.name : null;
    if (pid && name) nameByProduct.set(pid, name);
  }
  return nameByProduct;
}

/**
 * Orders (open only) containing at least one oversold line — available < 0.
 * Backorders are allowed, so a negative available is how we flag "out of stock".
 */
function deriveOutOfStockOrderIds(
  itemRows: Row[],
  openOrderIds: Set<string>,
  availableByProduct: Map<string, number>
): Set<string> {
  const oos = new Set<string>();
  for (const it of itemRows) {
    const orderId = typeof it.order_id === "string" ? it.order_id : null;
    if (!orderId || !openOrderIds.has(orderId)) continue;
    const pid = typeof it.product_id === "string" ? it.product_id : null;
    if (!pid) continue;
    const avail = availableByProduct.get(pid);
    if (avail !== undefined && avail < 0) oos.add(orderId);
  }
  return oos;
}

/** Compact per-order product list (name + ordered quantity) for the list view. */
function buildOrderProductSummaries(
  itemRows: Row[],
  nameByProduct: Map<string, string>
): Map<string, OrderProductSummary[]> {
  const result = new Map<string, OrderProductSummary[]>();
  for (const it of itemRows) {
    const orderId = typeof it.order_id === "string" ? it.order_id : null;
    if (!orderId) continue;
    const pid = typeof it.product_id === "string" ? it.product_id : null;
    const name = (pid && nameByProduct.get(pid)) || "פריט";
    const quantity = Number(it.quantity_ordered ?? 0) || 0;
    const delivered = Number(it.quantity_delivered ?? 0) || 0;
    const list = result.get(orderId) ?? [];
    list.push({ name, quantity, delivered });
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
 * For a set of customer ids, return the set that is flagged "pay ahead"
 * (customers.requires_prepayment). Lets the list paint an unpaid pay-ahead order
 * red as a "don't deliver without payment" reminder. Fetched here rather than
 * added to order_overview_view — a small by-id query beats redefining a view
 * several pages depend on.
 */
async function fetchPrepaymentCustomerIds(
  supabase: SupabaseClient,
  customerIds: string[]
): Promise<Set<string>> {
  if (customerIds.length === 0) return new Set();
  const { data } = await supabase
    .from("customers")
    .select("id")
    .in("id", customerIds)
    .eq("requires_prepayment", true);
  return new Set(
    ((data ?? []) as Row[])
      .map((r) => (typeof r.id === "string" ? r.id : ""))
      .filter(Boolean)
  );
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
      `customer_branch_name.ilike.%${escaped}%`,
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
  const rowsWithDue = await enrichOrderRows(supabase, rows);

  const totalCount = typeof count === "number" ? count : rows.length;
  // Drive "has more" off page fullness, not the estimated count.
  const hasMore = rows.length === ORDERS_PAGE_SIZE;

  return { rows: rowsWithDue, totalCount, hasMore, error: error?.message ?? null };
}

/**
 * Load full order_overview_view rows (enriched with products, stock, pending
 * payment methods, due dates) for an explicit id list — used by the
 * client-side search index to fetch real data for its currently-matched rows
 * without paginating through the whole list.
 */
export async function loadOrdersByIds(supabase: SupabaseClient, ids: string[]): Promise<Row[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("order_overview_view").select(ORDER_SELECT).in("order_id", ids);
  return enrichOrderRows(supabase, (data ?? []) as Row[]);
}

/**
 * Enrich base order rows (order_overview_view columns) with product summaries,
 * out-of-stock flags, pending payment methods, prepayment flags and effective
 * due dates. Shared by the paginated list load above and loadOrdersByIds.
 */
async function enrichOrderRows(supabase: SupabaseClient, rows: Row[]): Promise<Row[]> {
  const allOrderIds = rows
    .map((r) => (typeof r.order_id === "string" ? r.order_id : ""))
    .filter(Boolean);
  // Only open orders reserve stock, so closed/delivered/cancelled are never
  // flagged out-of-stock.
  const openOrderIds = new Set(
    rows
      .filter((r) => !CLOSED_ORDER_STATUSES.includes(String(r.status ?? "").toLowerCase()))
      .map((r) => (typeof r.order_id === "string" ? r.order_id : ""))
      .filter(Boolean)
  );
  const customerIds = Array.from(
    new Set(
      rows.map((r) => (typeof r.customer_id === "string" ? r.customer_id : "")).filter(Boolean)
    )
  );

  // Single order_items read feeds BOTH the product summaries and the OOS flag.
  const itemRows = await fetchOrderItems(supabase, allOrderIds);
  const productIds = Array.from(
    new Set(
      itemRows
        .map((r) => (typeof r.product_id === "string" ? r.product_id : null))
        .filter((v): v is string => Boolean(v))
    )
  );

  const [orderDueById, availableByProduct, nameByProduct, pendingMethodsByOrder, prepaymentCustomerIds] =
    await Promise.all([
      fetchOrderDueDates(supabase, allOrderIds),
      fetchInventoryAvailability(supabase, productIds),
      fetchProductNames(supabase, productIds),
      fetchOrderPendingMethods(supabase, allOrderIds),
      fetchPrepaymentCustomerIds(supabase, customerIds),
    ]);

  const outOfStockIds = deriveOutOfStockOrderIds(itemRows, openOrderIds, availableByProduct);
  const productsByOrder = buildOrderProductSummaries(itemRows, nameByProduct);

  return rows.map((r) => {
    const orderId = typeof r.order_id === "string" ? r.order_id : "";
    const customerId = typeof r.customer_id === "string" ? r.customer_id : "";
    const pending = pendingMethodsByOrder.get(orderId);
    return {
      ...r,
      due_date: orderDueById.get(orderId)?.dueDate ?? null,
      out_of_stock: outOfStockIds.has(orderId),
      products: productsByOrder.get(orderId) ?? [],
      pending_payment_methods: pending?.methods ?? [],
      pending_check_number: pending?.checkNumber ?? null,
      customer_requires_prepayment: prepaymentCustomerIds.has(customerId),
    };
  });
}

/** A lightweight order row for the in-memory client search index. */
export type OrderSearchIndexEntry = {
  id: string;
  customer_id: string;
  customer_name: string;
  branch_id: string | null;
  customer_branch_name: string | null;
  status: string;
  order_date: string | null;
  needs_invoice: boolean | null;
  invoice_sent_at: string | null;
};

const SEARCH_INDEX_ORDER_CAP = 20000;

/**
 * Load EVERY order (lightweight — identity fields only, no payment
 * aggregation) for the client-side search index. Fetched once per session and
 * searched in memory so order type-ahead is instant instead of a network
 * round-trip per keystroke; matched rows are then enriched via loadOrdersByIds.
 * Reads straight from orders/customers/customer_branches — not
 * order_overview_view, which forces a full payments aggregation this index
 * doesn't need.
 */
export async function loadOrderSearchIndexRows(supabase: SupabaseClient): Promise<OrderSearchIndexEntry[]> {
  const { data } = await supabase
    .from("orders")
    .select(
      "id,customer_id,branch_id,status,order_date,needs_invoice,invoice_sent_at,customers(name),customer_branches(name)"
    )
    .order("order_date", { ascending: false })
    .range(0, SEARCH_INDEX_ORDER_CAP - 1);

  return ((data ?? []) as Row[])
    .map((row) => {
      const customer = row?.customers as { name?: string } | null;
      const branch = row?.customer_branches as { name?: string } | null;
      return {
        id: typeof row?.id === "string" ? row.id : "",
        customer_id: typeof row?.customer_id === "string" ? row.customer_id : "",
        customer_name: typeof customer?.name === "string" ? customer.name : "",
        branch_id: typeof row?.branch_id === "string" ? row.branch_id : null,
        customer_branch_name: typeof branch?.name === "string" ? branch.name : null,
        status: typeof row?.status === "string" ? row.status : "",
        order_date: typeof row?.order_date === "string" ? row.order_date : null,
        needs_invoice: typeof row?.needs_invoice === "boolean" ? row.needs_invoice : null,
        invoice_sent_at: typeof row?.invoice_sent_at === "string" ? row.invoice_sent_at : null,
      };
    })
    .filter((entry) => entry.id);
}
