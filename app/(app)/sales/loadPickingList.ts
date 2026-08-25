import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

// Same defensive belt-and-suspenders filter as loadDeliveries.ts: the view
// already restricts to open statuses, but some rows carry the Hebrew label
// instead of the enum value.
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

export type PickingListLine = {
  key: string;
  name: string;
  sku: string | null;
  /** Still-outstanding quantity for this line (ordered minus already delivered). */
  remaining: number;
};

export type PickingListDelivery = {
  orderId: string;
  city: string;
  items: PickingListLine[];
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
 * Every open delivery with its still-outstanding line items, for the warehouse
 * picking list. Unlike loadDeliveries.ts this is NOT paginated — the picking
 * list needs the full open-delivery set to total correctly, and city filtering
 * happens client-side over this whole set (see PickingListDialog.tsx).
 */
export async function loadPickingListSource(
  supabase: SupabaseClient
): Promise<PickingListDelivery[]> {
  const { data: deliveryRows } = await supabase
    .from("delivery_overview_view")
    .select("order_id,customer_city,status")
    .not("status", "in", `(${CLOSED_ORDER_STATUSES.join(",")})`);

  const deliveries = ((deliveryRows ?? []) as Row[])
    .map((row) => ({
      orderId: getString(row, "order_id") ?? "",
      city: getString(row, "customer_city") ?? "ללא עיר",
      items: [] as PickingListLine[],
    }))
    .filter((row) => row.orderId);

  if (deliveries.length === 0) return [];

  const orderIds = deliveries.map((delivery) => delivery.orderId);
  const { data: itemRows } = await supabase
    .from("order_items")
    .select("order_id,product_id,quantity_ordered,quantity_delivered,description")
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
  const productById = new Map(
    ((productRows ?? []) as Row[]).map((row) => [
      getString(row, "id") ?? "",
      { name: getString(row, "name"), sku: getString(row, "sku") },
    ])
  );

  const itemsByOrder = new Map<string, PickingListLine[]>();
  for (const row of (itemRows ?? []) as Row[]) {
    const orderId = getString(row, "order_id");
    if (!orderId) continue;
    const remaining = (getNumber(row, "quantity_ordered") ?? 0) - (getNumber(row, "quantity_delivered") ?? 0);
    if (remaining <= 0) continue;

    const productId = getString(row, "product_id");
    const description = getString(row, "description");
    const product = productId ? productById.get(productId) : undefined;
    const key = productId ?? `custom:${description ?? ""}`;
    const name = product?.name || description || "פריט מותאם";

    const list = itemsByOrder.get(orderId) ?? [];
    list.push({ key, name, sku: product?.sku ?? null, remaining });
    itemsByOrder.set(orderId, list);
  }

  for (const delivery of deliveries) {
    delivery.items = itemsByOrder.get(delivery.orderId) ?? [];
  }

  return deliveries;
}
