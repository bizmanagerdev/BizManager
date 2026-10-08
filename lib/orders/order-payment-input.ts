import { buildPaymentInsert } from "@/lib/payments";
import { normalizePaymentEntries } from "@/lib/orders/paymentStatus";

// An order payment (or refund) as the order's payment form sends it, made into
// its row the SAME way on the server (app/api/orders/payments/create) and on
// the phone (lib/payments/device-payment-saves.ts, saving on the device copy
// first) — so the paid status the phone shows at once is the one the server
// then keeps.

export type OrderPaymentBody = {
  id?: unknown;
  order_id?: unknown;
  payment_date?: unknown;
  amount_total?: unknown;
  payment_method?: unknown;
  due_date?: unknown;
  reference_number?: unknown;
  check_number?: unknown;
  notes?: unknown;
  entry_type?: unknown;
  account_id?: unknown;
};

export type OrderPaymentRow = ReturnType<typeof buildPaymentInsert>;

/** The payment's row (without its id), or why it can't be saved. */
export function orderPaymentFrom(
  body: OrderPaymentBody,
  recordedBy: string
): { orderId: string; entryType: "payment" | "refund"; row: OrderPaymentRow } | { error: string } {
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  const [payment] = normalizePaymentEntries([body as never]);
  const entryType = body.entry_type === "refund" ? "refund" : "payment";
  const dueDate = typeof body.due_date === "string" && body.due_date.trim() ? body.due_date.trim() : null;

  if (!orderId) return { error: "חסר מזהה הזמנה." };
  if (
    !payment ||
    !Number.isFinite(payment.amount_total) ||
    payment.amount_total <= 0 ||
    !payment.payment_date ||
    !payment.payment_method
  ) {
    return { error: "יש להזין סכום, תאריך ואמצעי תשלום." };
  }
  if (payment.payment_method === "check" && !dueDate) return { error: "יש להזין תאריך פירעון לצ'ק" };

  const signedAmount = entryType === "refund" ? payment.amount_total * -1 : payment.amount_total;
  const notePrefix = entryType === "refund" ? "Refund" : "";
  return {
    orderId,
    entryType,
    row: buildPaymentInsert({
      amountTotal: signedAmount,
      businessDomain: "sales",
      orderId,
      paymentDate: payment.payment_date,
      paymentMethod: payment.payment_method,
      dueDate,
      referenceNumber: payment.reference_number,
      checkNumber: payment.payment_method === "check" ? payment.check_number : null,
      notes: payment.notes ? (notePrefix ? `${notePrefix}: ${payment.notes}` : payment.notes) : notePrefix || null,
      recordedBy,
      accountId: typeof body.account_id === "string" && body.account_id.trim() ? body.account_id.trim() : null,
    }),
  };
}
