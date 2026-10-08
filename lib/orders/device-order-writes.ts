import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import { clientRowId } from "@/lib/client-row-id";
import { buildPaymentInsert } from "@/lib/payments";
import { computeDueDate, normalizePaymentTerms } from "@/lib/paymentTerms";
import { derivePaymentStatus, normalizePaymentEntries, splitPaymentAmounts } from "@/lib/orders/paymentStatus";
import { normalizeOrderItems, orderTotals, resolveDelivered, toNonNegativeInt, type OrderItem } from "@/lib/orders/order-input";

// An order written into the device copy first (lib/orders/device-order-saves.ts):
// its row, its lines, its payments — and the stock it takes (reserved, or out
// for what's delivered), so this phone counts its own orders that haven't
// reached the server yet — all in one transaction, so PowerSync queues them
// together. Only the order's own change goes up (lib/powersync/local-writes.ts:
// the route body rides in its `_extras`, the request the form used to send);
// the lines, payments and stock come back from the server as it keeps them
// (its line and edit-payment ids are its own — they swap in at the next sync).

type Db = Pick<AbstractPowerSyncDatabase, "writeTransaction">;
type Tx = Pick<Transaction, "execute" | "getAll" | "getOptional">;

/** PowerSync stores a boolean as 1/0. */
const sqlBool = (value: unknown) => (typeof value === "boolean" ? (value ? 1 : 0) : null);
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const nonce = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** What the route works out for the order row, from the body the form sends. */
function orderFields(body: Record<string, unknown>) {
  const items = normalizeOrderItems(body.items);
  const discount = toNonNegativeInt(body.discount_amount ?? 0);
  const { subtotal, totalAmount } = orderTotals(items, Number.isFinite(discount) ? discount : 0);
  const orderDate = typeof body.order_date === "string" ? body.order_date : "";
  const terms = normalizePaymentTerms(body.payment_terms);
  const dueDate =
    typeof body.due_date === "string" && body.due_date.trim() ? body.due_date.trim() : computeDueDate(orderDate, terms);
  return { items, discount: Number.isFinite(discount) ? discount : 0, subtotal, totalAmount, orderDate, terms, dueDate };
}

/** Payment rows as the server builds them (lib/payments.buildPaymentInsert). */
function paymentRows(
  entries: unknown,
  ids: (string | null)[],
  order: { orderId: string; recordedBy: string; refund?: boolean }
) {
  return normalizePaymentEntries(entries as never).map((payment, i) => ({
    id: ids[i] ?? crypto.randomUUID(),
    ...buildPaymentInsert({
      amountTotal: order.refund ? payment.amount_total * -1 : payment.amount_total,
      businessDomain: "sales",
      orderId: order.orderId,
      paymentDate: payment.payment_date!,
      paymentMethod: payment.payment_method!,
      dueDate: payment.due_date,
      referenceNumber: payment.reference_number,
      checkNumber: payment.payment_method === "check" ? payment.check_number : null,
      notes: order.refund ? (payment.notes ? `Refund: ${payment.notes}` : "Refund") : payment.notes,
      recordedBy: order.recordedBy,
      accountId: payment.account_id,
    }),
  }));
}

async function insertLines(tx: Tx, orderId: string, lines: (OrderItem & { quantity_delivered: number })[]) {
  for (const line of lines) {
    await tx.execute(
      `INSERT INTO order_items (id, order_id, product_id, description, quantity_ordered, quantity_delivered,
         unit_price, discount_amount, line_total, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        orderId,
        line.product_id || null,
        line.product_id ? null : line.description || null,
        line.quantity_ordered,
        line.quantity_delivered,
        line.unit_price,
        line.discount_amount,
        line.quantity_ordered * line.unit_price - line.discount_amount,
        line.notes || null,
      ]
    );
  }
}

async function insertPayments(tx: Tx, rows: ReturnType<typeof paymentRows>, now: string) {
  for (const row of rows) {
    const columns = Object.keys(row);
    await tx.execute(
      `INSERT INTO payments (${columns.join(", ")}, created_at, updated_at) VALUES (${columns.map(() => "?").join(", ")}, ?, ?)`,
      [...Object.values(row).map((value) => (typeof value === "boolean" ? (value ? 1 : 0) : value)), now, now]
    );
  }
}

/** Stock each product's lines hold: reserved (not yet delivered) and out (delivered). */
function stockHeld(lines: { product_id: string | null; quantity_ordered: number; quantity_delivered: number }[], status: string) {
  const held = new Map<string, { reserved: number; out: number }>();
  if (status === "cancelled") return held;
  for (const line of lines) {
    if (!line.product_id) continue;
    const entry = held.get(line.product_id) ?? { reserved: 0, out: 0 };
    entry.reserved += Math.max(line.quantity_ordered - line.quantity_delivered, 0);
    entry.out += line.quantity_delivered;
    held.set(line.product_id, entry);
  }
  return held;
}

/** Move this phone's stock by what the order now holds minus what it held before. */
async function moveStock(tx: Tx, before: ReturnType<typeof stockHeld>, after: ReturnType<typeof stockHeld>) {
  for (const productId of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(productId) ?? { reserved: 0, out: 0 };
    const now = after.get(productId) ?? { reserved: 0, out: 0 };
    const reserved = now.reserved - was.reserved;
    const out = now.out - was.out;
    if (!reserved && !out) continue;
    await tx.execute(
      `UPDATE inventory SET quantity_reserved = coalesce(CAST(quantity_reserved AS REAL), 0) + ?,
         quantity_on_hand = coalesce(CAST(quantity_on_hand AS REAL), 0) - ? WHERE id = ?`,
      [reserved, out, productId]
    );
  }
}

/**
 * A new order on the device copy. `body`: what the form sends the create
 * route — its payments get their ids here (the route keeps them), and it goes
 * up as it is. `restore`: the form as it stood, put back as its draft if the
 * server refuses the order (so nothing typed is lost).
 */
export async function createOrderOnDevice(
  db: Db,
  order: { id: string; body: Record<string, unknown>; createdBy: string; restore?: { key: string; draft: unknown } }
): Promise<void> {
  const rawPayments = Array.isArray(order.body.payments) ? (order.body.payments as Record<string, unknown>[]) : [];
  const paymentIds = rawPayments.map((payment) => clientRowId(payment?.id) ?? crypto.randomUUID());
  const body: Record<string, unknown> = {
    ...order.body,
    id: order.id,
    payments: rawPayments.map((payment, i) => ({ ...payment, id: paymentIds[i] })),
  };
  const fields = orderFields(body);
  const status = (typeof body.status === "string" && body.status.trim() ? body.status.trim() : "draft").toLowerCase();
  const resolved = resolveDelivered(fields.items, status);
  const payments = paymentRows(body.payments, paymentIds, { orderId: order.id, recordedBy: order.createdBy });
  const paymentStatus = derivePaymentStatus(fields.totalAmount, splitPaymentAmounts(payments).collected);
  const now = new Date().toISOString();

  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO orders (id, customer_id, branch_id, order_date, status, subtotal, discount_amount, total_amount,
         payment_status, created_by, notes, payment_terms, due_date, needs_invoice, requested_delivery_date,
         collect_payment_on_delivery, created_at, updated_at, _extras)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order.id,
        body.customer_id ?? null,
        text(body.branch_id),
        fields.orderDate,
        resolved.status,
        fields.subtotal,
        fields.discount,
        fields.totalAmount,
        paymentStatus,
        order.createdBy,
        text(body.notes),
        fields.terms,
        fields.dueDate,
        sqlBool(body.needs_invoice),
        text(body.requested_delivery_date),
        body.collect_payment_on_delivery === true ? 1 : 0,
        now,
        now,
        JSON.stringify({ body, restore: order.restore ?? null, n: nonce() }),
      ]
    );
    await insertLines(tx, order.id, resolved.lines);
    await insertPayments(tx, payments, now);
    await moveStock(tx, new Map(), stockHeld(resolved.lines, resolved.status));
  });
}

/**
 * An order edited on the device copy (the order form): the row, its lines
 * (replaced, keeping what each product had delivered — as update_sales_order
 * does), the new payments and refunds, payment notes, and the stock it takes.
 * `body`: what the form sends the update route, which it goes up as.
 * False when the phone doesn't have the order: save on the server.
 */
export async function updateOrderOnDevice(
  db: Db,
  order: { id: string; body: Record<string, unknown>; updatedBy: string }
): Promise<boolean> {
  const body: Record<string, unknown> = { ...order.body, order_id: order.id };
  const fields = orderFields(body);
  const now = new Date().toISOString();

  return db.writeTransaction(async (tx) => {
    const current = await tx.getOptional<{ status: string | null }>("SELECT status FROM orders WHERE id = ?", [order.id]);
    if (!current) return false;
    const oldLines = await tx.getAll<{ product_id: string | null; quantity_ordered: unknown; quantity_delivered: unknown }>(
      "SELECT product_id, quantity_ordered, quantity_delivered FROM order_items WHERE order_id = ?",
      [order.id]
    );
    const before = oldLines.map((line) => ({
      product_id: line.product_id,
      quantity_ordered: Number(line.quantity_ordered) || 0,
      quantity_delivered: Number(line.quantity_delivered) || 0,
    }));
    const prior = new Map<string, number>();
    for (const line of before) if (line.product_id) prior.set(line.product_id, (prior.get(line.product_id) ?? 0) + line.quantity_delivered);

    // As the route and the RPC: none sent is "draft"; an empty one keeps the order's own.
    const sent = typeof body.status === "string" ? body.status : "draft";
    const status = (sent.trim() ? sent : current.status ?? "draft").trim().toLowerCase();
    const resolved = resolveDelivered(fields.items, status, prior);

    const existing = await tx.getAll<{ amount_total: unknown; net_amount: unknown; payment_status: string | null; due_date: string | null }>(
      "SELECT amount_total, net_amount, payment_status, due_date FROM payments WHERE order_id = ?",
      [order.id]
    );
    const added = paymentRows(body.payments, [], { orderId: order.id, recordedBy: order.updatedBy });
    const refunds = paymentRows(body.refunds, [], { orderId: order.id, recordedBy: order.updatedBy, refund: true });
    const paid = splitPaymentAmounts([...(existing as never[]), ...added, ...refunds]).collected;
    const paymentStatus = derivePaymentStatus(fields.totalAmount, paid);

    await tx.execute(
      `UPDATE orders SET customer_id = ?, branch_id = ?, order_date = ?, status = ?, subtotal = ?, discount_amount = ?,
         total_amount = ?, payment_status = ?, notes = ?, payment_terms = ?, due_date = ?, requested_delivery_date = ?,
         collect_payment_on_delivery = coalesce(?, collect_payment_on_delivery), updated_at = ?, _extras = ?
       WHERE id = ?`,
      [
        body.customer_id ?? null,
        text(body.branch_id),
        fields.orderDate,
        resolved.status,
        fields.subtotal,
        fields.discount,
        fields.totalAmount,
        paymentStatus,
        text(body.notes),
        fields.terms,
        fields.dueDate,
        text(body.requested_delivery_date),
        sqlBool(body.collect_payment_on_delivery),
        now,
        JSON.stringify({ body, n: nonce() }),
        order.id,
      ]
    );
    await tx.execute("DELETE FROM order_items WHERE order_id = ?", [order.id]);
    await insertLines(tx, order.id, resolved.lines);
    await insertPayments(tx, [...added, ...refunds], now);
    for (const entry of Array.isArray(body.existing_payment_notes) ? (body.existing_payment_notes as Record<string, unknown>[]) : []) {
      if (typeof entry?.id !== "string") continue;
      await tx.execute("UPDATE payments SET notes = ? WHERE id = ? AND order_id = ?", [text(entry.notes), entry.id, order.id]);
    }
    await moveStock(
      tx,
      stockHeld(before, (current.status ?? "").toLowerCase()),
      stockHeld(resolved.lines.map((line) => ({ ...line, product_id: line.product_id || null })), resolved.status)
    );
    return true;
  });
}
