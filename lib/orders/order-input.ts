// An order's lines and totals as the order form sends them — worked out the
// SAME way on the server (app/api/orders/create, app/api/orders/update) and on
// the phone (lib/orders/device-order-saves.ts, saving on the device copy
// first), so the order the phone shows at once is the order the server keeps.
// The delivered amounts and the effective status mirror the database's own
// create_sales_order / update_sales_order (the server's are the ones kept).

export type OrderItemInput = {
  product_id?: string;
  /** Free-text name for an off-catalog ("custom") line — no product_id. */
  description?: string | null;
  quantity_ordered?: number | string;
  quantity_delivered?: number | string;
  unit_price?: number | string;
  discount_amount?: number | string;
  notes?: string | null;
};

export type OrderItem = {
  product_id: string;
  description: string;
  quantity_ordered: number;
  unit_price: number;
  discount_amount: number;
  notes: string | null;
  /** Only when the caller sent it (the delivery confirmation does). */
  quantity_delivered?: number;
};

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

export function toNonNegativeInt(value: unknown) {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.max(0, Math.round(parsed));
}

function toPositiveInt(value: unknown) {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.max(1, Math.round(parsed));
}

/** The lines as the routes take them (quantity_delivered only when sent). */
export function normalizeOrderItems(items: unknown): OrderItem[] {
  return (Array.isArray(items) ? (items as OrderItemInput[]) : []).map((item) => {
    const base = {
      product_id: typeof item.product_id === "string" ? item.product_id : "",
      description: typeof item.description === "string" ? item.description.trim() : "",
      quantity_ordered: toPositiveInt(item.quantity_ordered),
      unit_price: toNonNegativeInt(item.unit_price),
      discount_amount: toNonNegativeInt(item.discount_amount ?? 0),
      notes: typeof item.notes === "string" ? item.notes.trim() : null,
    };
    if (item.quantity_delivered !== undefined && item.quantity_delivered !== null) {
      return { ...base, quantity_delivered: toNonNegativeInt(item.quantity_delivered) };
    }
    return base;
  });
}

/** A line is a catalog product OR a described custom line, with sane numbers. */
export function findInvalidOrderItem(items: OrderItem[]): OrderItem | undefined {
  return items.find(
    (item) =>
      (!item.product_id && !item.description) ||
      !Number.isFinite(item.quantity_ordered) ||
      item.quantity_ordered <= 0 ||
      !Number.isFinite(item.unit_price) ||
      item.unit_price < 0 ||
      !Number.isFinite(item.discount_amount) ||
      item.discount_amount < 0
  );
}

/** The order's subtotal, and its total (never below 0 — see derivePaymentStatus). */
export function orderTotals(items: OrderItem[], discountAmount: number) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity_ordered * item.unit_price - item.discount_amount, 0);
  return { subtotal, totalAmount: Math.max(0, subtotal - discountAmount) };
}

const FINISHED = new Set(["delivered", "completed", "closed"]);

/**
 * Each line's delivered amount and the order's effective status, as the
 * database works them out: cancelled → none delivered; a sent amount (capped
 * to the line); else — on an edit — what the product had delivered before
 * (`prior`, by product, drained across its lines); else all of it for a
 * finished order, none otherwise. A finished order with a line short is
 * "partially_delivered".
 */
export function resolveDelivered(
  items: OrderItem[],
  status: string,
  prior?: Map<string, number>
): { lines: (OrderItem & { quantity_delivered: number })[]; status: string } {
  const target = (status.trim() || "draft").toLowerCase();
  const left = new Map(prior ?? []);
  let totalQty = 0;
  let totalDelivered = 0;
  const lines = items.map((item) => {
    let delivered: number;
    if (target === "cancelled") delivered = 0;
    else if (item.quantity_delivered !== undefined) delivered = Math.min(Math.max(item.quantity_delivered, 0), item.quantity_ordered);
    else if (prior && item.product_id) {
      const had = left.get(item.product_id) ?? 0;
      delivered = Math.min(had, item.quantity_ordered);
      left.set(item.product_id, Math.max(had - delivered, 0));
    } else delivered = FINISHED.has(target) ? item.quantity_ordered : 0;
    totalQty += item.quantity_ordered;
    totalDelivered += delivered;
    return { ...item, quantity_delivered: delivered };
  });
  const effective = FINISHED.has(target) && totalDelivered + 0.0000001 < totalQty ? "partially_delivered" : target;
  return { lines, status: effective };
}
