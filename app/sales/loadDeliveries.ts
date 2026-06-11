import type { SupabaseClient } from "@supabase/supabase-js";

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

export type DeliveryItem = {
  id: string;
  customerId: string;
  orderDate: string | null;
  status: string;
  totalAmount: number | null;
  /** Driver collects the payment on delivery (orders.collect_payment_on_delivery). */
  collectOnDelivery: boolean;
  notes: string | null;
  customerName: string;
  customerPhone: string | null;
  city: string;
  address: string;
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
      collectOnDelivery: false,
      notes: getString(row, "notes"),
      customerName: getString(row, "customer_name") ?? "לקוח",
      customerPhone: getString(row, "customer_phone"),
      city: getString(row, "customer_city") ?? "ללא עיר",
      address: getString(row, "customer_address") ?? "-",
    }))
    .filter((row) => row.id);

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

  const totalCount = typeof count === "number" ? count : deliveries.length;
  // Drive "has more" off page fullness, not the estimated count.
  const hasMore = deliveries.length === DELIVERIES_PAGE_SIZE;

  return { deliveries, totalCount, hasMore, error: error?.message ?? null };
}
