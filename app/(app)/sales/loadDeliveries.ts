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
  quantity: number;
  notes: string | null;
};

export type DeliveryItem = {
  id: string;
  customerId: string;
  orderDate: string | null;
  status: string;
  totalAmount: number | null;
  /** Amount already collected for the order, and the derived payment status. */
  totalPaid: number;
  paymentStatus: PaymentStatus;
  /** Driver collects the payment on delivery (orders.collect_payment_on_delivery). */
  collectOnDelivery: boolean;
  notes: string | null;
  customerName: string;
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
      "order_id,customer_id,customer_name,customer_phone,customer_address,customer_city,order_date,created_at,status,total_amount,notes",
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
      orderDate: getString(row, "order_date") ?? getString(row, "created_at"),
      status: getString(row, "status") ?? "-",
      totalAmount: getNumber(row, "total_amount"),
      totalPaid: 0,
      paymentStatus: "unpaid" as PaymentStatus,
      collectOnDelivery: false,
      notes: getString(row, "notes"),
      customerName: getString(row, "customer_name") ?? "לקוח",
      customerPhone: getString(row, "customer_phone"),
      city: getString(row, "customer_city") ?? "ללא עיר",
      address: getString(row, "customer_address") ?? "-",
      items: [] as DeliveryOrderItem[],
      requiresPrepayment: false,
      deliveryInstructions: null as string | null,
      deliveryLat: null as number | null,
      deliveryLng: null as number | null,
    }))
    .filter((row) => row.id);

  // Arrival directions + drop-off pin live on the CUSTOMER (see the
  // customer_delivery_location migration) so they survive from one delivery to
  // the next. Fetched here rather than added to delivery_overview_view — a
  // second small query by id beats redefining a view other pages depend on.
  if (deliveries.length > 0) {
    const customerIds = Array.from(new Set(deliveries.map((d) => d.customerId).filter(Boolean)));
    if (customerIds.length > 0) {
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
    }
  }

  // Attach each order's products so the driver sees what to load/deliver.
  if (deliveries.length > 0) {
    const orderIds = deliveries.map((delivery) => delivery.id);
    const { data: itemRows } = await supabase
      .from("order_items")
      .select("order_id,product_id,quantity_ordered,notes")
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
      const list = itemsByOrder.get(orderId) ?? [];
      list.push({
        name: productNameById.get(productId) || "מוצר",
        quantity: getNumber(row, "quantity_ordered") ?? 0,
        notes: getString(row, "notes"),
      });
      itemsByOrder.set(orderId, list);
    }
    for (const delivery of deliveries) {
      delivery.items = itemsByOrder.get(delivery.id) ?? [];
    }
  }

  // Best-effort flag read straight from orders (the column only exists after
  // db/sql/add_collect_payment_on_delivery.sql; on error everything stays false).
  if (deliveries.length > 0) {
    const { data: collectRows } = await supabase
      .from("orders")
      .select("id,collect_payment_on_delivery")
      .in("id", deliveries.map((delivery) => delivery.id))
      .eq("collect_payment_on_delivery", true);
    const collectIds = new Set(
      ((collectRows ?? []) as Row[])
        .map((row) => (typeof row.id === "string" ? row.id : ""))
        .filter(Boolean)
    );
    for (const delivery of deliveries) {
      delivery.collectOnDelivery = collectIds.has(delivery.id);
    }
  }

  // Attach the order's payment status so the driver/dispatcher sees whether it's
  // been paid before delivering. Read collected money from the financials view.
  if (deliveries.length > 0) {
    const { data: financialRows } = await supabase
      .from("order_financials_view")
      .select("id,total_amount,total_paid")
      .in("id", deliveries.map((delivery) => delivery.id));
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
  }

  const totalCount = typeof count === "number" ? count : deliveries.length;
  // Drive "has more" off page fullness, not the estimated count.
  const hasMore = deliveries.length === DELIVERIES_PAGE_SIZE;

  return { deliveries, totalCount, hasMore, error: error?.message ?? null };
}
