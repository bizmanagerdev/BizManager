import type { SupabaseClient } from "@supabase/supabase-js";
import { derivePaymentStatus, type PaymentStatus } from "@/lib/orders/paymentStatus";

type Row = Record<string, unknown>;

export const DELIVERIES_PAGE_SIZE = 50;

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

export type DeliveryOrderItem = {
  name: string;
  /** Ordered quantity for this line. */
  quantity: number;
  /** How much of this line was already handed over (partial deliveries). */
  delivered: number;
  notes: string | null;
};

export type DeliveryItem = {
  id: string;
  customerId: string;
  /** Set only when the order is for a specific one of the customer's branches. */
  branchId: string | null;
  orderDate: string | null;
  status: string;
  totalAmount: number | null;
  /** Amount already collected for the order, and the derived payment status. */
  totalPaid: number;
  paymentStatus: PaymentStatus;
  /** Driver collects the payment on delivery (orders.collect_payment_on_delivery). */
  collectOnDelivery: boolean;
  /** The date the customer actually asked for (orders.requested_delivery_date) —
   *  distinct from order_date/delivery_confirmed_at. Null when never set. */
  requestedDeliveryDate: string | null;
  notes: string | null;
  customerName: string;
  /** Set only when the order is for a specific one of the customer's branches. */
  customerBranchName: string | null;
  customerPhone: string | null;
  city: string;
  address: string;
  /** The order's products, so the driver sees what to load/deliver. */
  items: DeliveryOrderItem[];
  /** Customer is flagged "pay ahead" (customers.requires_prepayment). */
  requiresPrepayment: boolean;
  /** Standing arrival directions for this customer ("around the corner, blue gate"). */
  deliveryInstructions: string | null;
  /** The saved drop-off pin — navigation prefers it over the address string. */
  deliveryLat: number | null;
  deliveryLng: number | null;
};

export type DeliveriesFilters = { customerId: string | null };

/** Customer name, with the branch appended when set — e.g. "פיצה אורי · סניף
 *  בית שמש". Shared by every surface that renders a delivery/order's customer
 *  (the deliveries queue's grouped rows, the delivery slip share sheet). */
export function combinedCustomerName(item: { customerName: string; customerBranchName: string | null }) {
  return item.customerBranchName ? `${item.customerName} · סניף ${item.customerBranchName}` : item.customerName;
}

export type DeliveriesPageResult = {
  deliveries: DeliveryItem[];
  totalCount: number;
  hasMore: boolean;
  error: string | null;
};

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function getNumber(row: Row, key: string) {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Load one page of open deliveries. Grouping by region/city/customer happens on
 * the client so it can run over the accumulated, scroll-loaded list. Shared by
 * the initial server render (page 1) and the fetch-on-scroll server action.
 */
export async function loadDeliveriesPage(
  supabase: SupabaseClient,
  { page, filters }: { page: number; filters: DeliveriesFilters }
): Promise<DeliveriesPageResult> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const from = (safePage - 1) * DELIVERIES_PAGE_SIZE;
  const to = safePage * DELIVERIES_PAGE_SIZE - 1;

  let deliveriesQuery = supabase
    .from("delivery_overview_view")
    .select(
      "order_id,customer_id,branch_id,customer_name,customer_phone,customer_address,customer_city,order_date,created_at,status,total_amount,notes,customer_branch_name,branch_address,branch_city",
      { count: "estimated" }
    )
    .not("status", "in", `(${CLOSED_ORDER_STATUSES.join(",")})`)
    .order("order_date", { ascending: false });

  if (filters.customerId) deliveriesQuery = deliveriesQuery.eq("customer_id", filters.customerId);

  const { data, error, count } = await deliveriesQuery.range(from, to);

  const deliveries = ((data ?? []) as Row[])
    .map((row) => ({
      id: getString(row, "order_id") ?? "",
      customerId: getString(row, "customer_id") ?? "",
      branchId: getString(row, "branch_id"),
      orderDate: getString(row, "order_date") ?? getString(row, "created_at"),
      status: getString(row, "status") ?? "-",
      totalAmount: getNumber(row, "total_amount"),
      totalPaid: 0,
      paymentStatus: "unpaid" as PaymentStatus,
      collectOnDelivery: false,
      requestedDeliveryDate: null as string | null,
      notes: getString(row, "notes"),
      customerName: getString(row, "customer_name") ?? "לקוח",
      customerBranchName: getString(row, "customer_branch_name"),
      customerPhone: getString(row, "customer_phone"),
      // A branch's own address (when the order is for one) is where the
      // driver actually needs to go — falls back to the customer's own
      // address/city when the order isn't for a specific branch.
      city: getString(row, "branch_city") ?? getString(row, "customer_city") ?? "ללא עיר",
      address: getString(row, "branch_address") ?? getString(row, "customer_address") ?? "-",
      items: [] as DeliveryOrderItem[],
      requiresPrepayment: false,
      deliveryInstructions: null as string | null,
      deliveryLat: null as number | null,
      deliveryLng: null as number | null,
    }))
    .filter((row) => row.id);

  // Four follow-up reads, each keyed only off the order-id list from the page
  // query above and each writing its own distinct fields — independent of one
  // another, so they run CONCURRENTLY instead of one after another.
  if (deliveries.length > 0) {
    const orderIds = deliveries.map((delivery) => delivery.id);

    await Promise.all([
      // Arrival directions + drop-off pin live on the CUSTOMER (see the
      // customer_delivery_location migration) so they survive from one delivery
      // to the next. Fetched here rather than added to delivery_overview_view —
      // a second small query by id beats redefining a view other pages depend on.
      (async () => {
        const customerIds = Array.from(new Set(deliveries.map((d) => d.customerId).filter(Boolean)));
        if (customerIds.length === 0) return;
        const { data: customerRows } = await supabase
          .from("customers")
          .select("id,delivery_instructions,delivery_lat,delivery_lng,requires_prepayment")
          .in("id", customerIds);
        const byId = new Map(((customerRows ?? []) as Row[]).map((row) => [getString(row, "id") ?? "", row]));
        for (const delivery of deliveries) {
          const row = byId.get(delivery.customerId);
          if (!row) continue;
          delivery.deliveryInstructions = getString(row, "delivery_instructions");
          delivery.deliveryLat = getNumber(row, "delivery_lat");
          delivery.deliveryLng = getNumber(row, "delivery_lng");
          delivery.requiresPrepayment = row.requires_prepayment === true;
        }
      })(),

      // Attach each order's products so the driver sees what to load/deliver.
      (async () => {
        const { data: itemRows } = await supabase
          .from("order_items")
          .select("order_id,product_id,quantity_ordered,quantity_delivered,notes")
          .in("order_id", orderIds);

        const productIds = Array.from(
          new Set(
            ((itemRows ?? []) as Row[])
              .map((row) => getString(row, "product_id"))
              .filter((value): value is string => Boolean(value))
          )
        );
        const { data: productRows } =
          productIds.length > 0
            ? await supabase.from("products").select("id,name,sku").in("id", productIds)
            : { data: [] as Row[] };
        const productNameById = new Map(
          ((productRows ?? []) as Row[]).map((row) => [
            getString(row, "id") ?? "",
            getString(row, "name") ?? getString(row, "sku") ?? "מוצר",
          ])
        );

        const itemsByOrder = new Map<string, DeliveryOrderItem[]>();
        for (const row of (itemRows ?? []) as Row[]) {
          const orderId = getString(row, "order_id");
          if (!orderId) continue;
          const productId = getString(row, "product_id") ?? "";
          // Carry ordered + delivered so the card can show "ordered vs already
          // handed over" and the driver sees exactly what's still owed.
          const list = itemsByOrder.get(orderId) ?? [];
          list.push({
            name: productNameById.get(productId) || "מוצר",
            quantity: getNumber(row, "quantity_ordered") ?? 0,
            delivered: getNumber(row, "quantity_delivered") ?? 0,
            notes: getString(row, "notes"),
          });
          itemsByOrder.set(orderId, list);
        }
        for (const delivery of deliveries) {
          delivery.items = itemsByOrder.get(delivery.id) ?? [];
        }
      })(),

      // Best-effort fields read straight from orders: collect_payment_on_delivery
      // (the column only exists after db/sql/add_collect_payment_on_delivery.sql)
      // and requested_delivery_date (the customer's own asked-for date). On error
      // everything stays at its default (false / null).
      (async () => {
        const { data: orderRows } = await supabase
          .from("orders")
          .select("id,collect_payment_on_delivery,requested_delivery_date")
          .in("id", orderIds);
        const byId = new Map(
          ((orderRows ?? []) as Row[]).map((row) => [getString(row, "id") ?? "", row])
        );
        for (const delivery of deliveries) {
          const row = byId.get(delivery.id);
          delivery.collectOnDelivery = row?.collect_payment_on_delivery === true;
          delivery.requestedDeliveryDate = row ? getString(row, "requested_delivery_date") : null;
        }
      })(),

      // Attach the order's payment status so the driver/dispatcher sees whether
      // it's been paid before delivering. Read collected money from the
      // financials view.
      (async () => {
        const { data: financialRows } = await supabase
          .from("order_financials_view")
          .select("id,total_amount,total_paid")
          .in("id", orderIds);
        const financialsById = new Map(
          ((financialRows ?? []) as Row[]).map((row) => [getString(row, "id") ?? "", row])
        );
        for (const delivery of deliveries) {
          const financials = financialsById.get(delivery.id);
          const totalAmount = financials ? getNumber(financials, "total_amount") : null;
          const totalPaid = financials ? getNumber(financials, "total_paid") ?? 0 : 0;
          delivery.totalPaid = totalPaid;
          delivery.paymentStatus = derivePaymentStatus(
            totalAmount ?? delivery.totalAmount ?? 0,
            totalPaid
          );
        }
      })(),
    ]);
  }

  const totalCount = typeof count === "number" ? count : deliveries.length;
  // Drive "has more" off page fullness, not the estimated count.
  const hasMore = deliveries.length === DELIVERIES_PAGE_SIZE;

  return { deliveries, totalCount, hasMore, error: error?.message ?? null };
}
