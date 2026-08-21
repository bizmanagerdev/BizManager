import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import {
  tryAutoIssueInvoiceForOrder,
  tryAutoIssueReceiptForPayment,
} from "@/lib/morning/service";
import { buildPaymentInsert } from "@/lib/payments";
import { notifyNewEntity } from "@/lib/notifications/new-entity";
import {
  derivePaymentStatus,
  hasInvalidPaymentEntry,
  normalizePaymentEntries,
  splitPaymentAmounts,
} from "@/lib/orders/paymentStatus";
import { computeDueDate, normalizePaymentTerms } from "@/lib/paymentTerms";

type CreateOrderItemPayload = {
  product_id?: string;
  /** Free-text name for an off-catalog ("custom") line — no product_id. */
  description?: string | null;
  quantity_ordered?: number | string;
  quantity_delivered?: number | string;
  unit_price?: number | string;
  discount_amount?: number | string;
  notes?: string | null;
};

type CreateOrderPayload = {
  customer_id?: string;
  order_date?: string;
  status?: string;
  payment_status?: string;
  payment_terms?: string | null;
  due_date?: string | null;
  /** Optional — only set when the customer asked for a specific delivery date. */
  requested_delivery_date?: string | null;
  discount_amount?: number | string;
  needs_invoice?: boolean | null;
  collect_payment_on_delivery?: boolean | null;
  notes?: string | null;
  payments?: {
    amount_total?: number | string;
    payment_date?: string | null;
    payment_method?: string | null;
    account_id?: string | null;
    due_date?: string | null;
    reference_number?: string | null;
    check_number?: string | null;
    notes?: string | null;
  }[];
  items?: CreateOrderItemPayload[];
};

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function toNonNegativeInt(value: unknown) {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.max(0, Math.round(parsed));
}

function toPositiveInt(value: unknown) {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.max(1, Math.round(parsed));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateOrderPayload;

    const customerId = typeof body.customer_id === "string" ? body.customer_id : "";
    const orderDate = typeof body.order_date === "string" ? body.order_date : "";
    const status = typeof body.status === "string" && body.status.trim() ? body.status.trim() : "draft";
    const discountAmount = toNonNegativeInt(body.discount_amount ?? 0);
    const needsInvoice = typeof body.needs_invoice === "boolean" ? body.needs_invoice : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const payments = normalizePaymentEntries(body.payments);

    const items = Array.isArray(body.items) ? body.items : [];
    if (!customerId || !orderDate || items.length === 0) {
      return NextResponse.json({ error: "יש לבחור לקוח, תאריך ולפחות פריט אחד." }, { status: 400 });
    }
    if (!Number.isFinite(discountAmount) || discountAmount < 0) {
      return NextResponse.json({ error: "סכום ההנחה אינו תקין." }, { status: 400 });
    }
    if (hasInvalidPaymentEntry(payments)) {
      return NextResponse.json({ error: "אחד התשלומים אינו תקין." }, { status: 400 });
    }

    const normalizedItems = items.map((item) => {
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

    // A line is valid as either a catalog product OR an off-catalog custom line
    // (a description with no product_id).
    const invalidItem = normalizedItems.find(
      (item) =>
        (!item.product_id && !item.description) ||
        !Number.isFinite(item.quantity_ordered) ||
        item.quantity_ordered <= 0 ||
        !Number.isFinite(item.unit_price) ||
        item.unit_price < 0 ||
        !Number.isFinite(item.discount_amount) ||
        item.discount_amount < 0
    );
    if (invalidItem) {
      return NextResponse.json({ error: "אחד הפריטים בהזמנה אינו תקין." }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    // Idempotency: a queued offline replay (or any network retry) with the same
    // Idempotency-Key returns the original cached response instead of creating a
    // second order + duplicate stock reservation + duplicate auto-invoice.
    return await withIdempotency(req, supabase, user.id, "orders/create", async () => {
    const subtotal = normalizedItems.reduce(
      (sum, item) => sum + item.quantity_ordered * item.unit_price - item.discount_amount,
      0
    );
    // Floor at 0: a discount larger than the goods must never yield a negative
    // total — derivePaymentStatus would otherwise read a negative total as שולם.
    const totalAmount = Math.max(0, subtotal - discountAmount);

    // Payment terms + the resulting due date are set inline at INSERT (passed to
    // the RPC) so a brand-new order is a single write — no follow-up UPDATE that
    // would log a spurious "order updated" audit row right after the create. An
    // explicit due_date overrides the term-computed one.
    const paymentTerms = normalizePaymentTerms(body.payment_terms);
    const dueDate =
      typeof body.due_date === "string" && body.due_date.trim()
        ? body.due_date.trim()
        : computeDueDate(orderDate, paymentTerms);

    // Build the payment rows up front so the stored payment_status reflects
    // COLLECTED money only — a future-dated check / net-term line is 'pending' and
    // must NOT stamp a brand-new order as שולם (matches order_overview_view and
    // the payments/create route). order_id is patched on after the RPC returns it.
    // Pay-ahead customers (customers.requires_prepayment) are intentionally NOT
    // blocked here — the order is flagged red in the UI until paid rather than
    // refused (which lost sales). See lib/orders/prepayment.
    const paymentInserts = payments.map((payment) =>
      buildPaymentInsert({
        amountTotal: payment.amount_total,
        businessDomain: "sales",
        paymentDate: payment.payment_date!,
        paymentMethod: payment.payment_method!,
        dueDate: payment.due_date,
        referenceNumber: payment.reference_number,
        checkNumber: payment.payment_method === "check" ? payment.check_number : null,
        notes: payment.notes,
        recordedBy: user.id,
        accountId: payment.account_id,
      })
    );
    const { collected: totalPaid } = splitPaymentAmounts(paymentInserts);
    const paymentStatus = derivePaymentStatus(totalAmount, totalPaid);

    const requestedDeliveryDate =
      typeof body.requested_delivery_date === "string" && body.requested_delivery_date.trim()
        ? body.requested_delivery_date.trim()
        : null;

    const { data, error } = await supabase.rpc("create_sales_order", {
      p_customer_id: customerId,
      p_order_date: orderDate,
      p_status: status,
      p_subtotal: subtotal,
      p_discount_amount: discountAmount,
      p_total_amount: totalAmount,
      p_payment_status: paymentStatus,
      p_created_by: user.id,
      p_notes: notes,
      p_items: normalizedItems,
      p_payment_terms: paymentTerms,
      p_due_date: dueDate,
      p_needs_invoice: needsInvoice,
      p_requested_delivery_date: requestedDeliveryDate,
    });

    if (error) {
      const missingRpc =
        error.message.includes("create_sales_order") || error.message.includes("function");
      if (missingRpc) {
        console.error("create_sales_order RPC missing", { message: error.message });
        return NextResponse.json(
          {
            error:
              "חסרה פונקציית מסד הנתונים create_sales_order. יש להריץ db/sql/create_sales_order_rpc.sql",
          },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    }

    const orderId = typeof data === "string" ? data : null;
    if (!orderId) return NextResponse.json({ error: "יצירת ההזמנה נכשלה." }, { status: 500 });

    const insertedPaymentIds: string[] = [];
    if (paymentInserts.length > 0) {
      const { data: insertedPaymentRows, error: paymentsInsertError } = await supabase
        .from("payments")
        .insert(paymentInserts.map((row) => ({ ...row, order_id: orderId })))
        .select("id");

      if (paymentsInsertError) {
        return NextResponse.json({ error: toHebrewError(paymentsInsertError.message) }, { status: 400 });
      }
      for (const row of insertedPaymentRows ?? []) {
        if (row && typeof (row as { id?: unknown }).id === "string") {
          insertedPaymentIds.push((row as { id: string }).id);
        }
      }
    }

    const derivedPaymentStatus = paymentStatus;

    // Best-effort, and only when explicitly turned ON: the column only exists
    // after db/sql/add_collect_payment_on_delivery.sql and defaults to false, so
    // there's nothing to write (and no extra audit row) for the common case.
    if (body.collect_payment_on_delivery === true) {
      await supabase
        .from("orders")
        .update({ collect_payment_on_delivery: true })
        .eq("id", orderId);
    }

    // Best-effort Morning auto-issue on new order: invoice for the order, plus a
    // receipt for each upfront payment line. Failures never abort the create. The
    // inserted ids come straight from the insert above (no re-query, which could
    // pick the wrong rows under concurrency).
    const actor = { profileId: profile.id, authUserId: user.id, role: profile.role };
    const invoiceOutcome = await tryAutoIssueInvoiceForOrder(supabase, {
      orderId,
      newStatus: status,
      trigger: "create",
      actor,
    });

    const receiptOutcomes: Array<{ skipped: boolean; reason: string | null; morningDocumentId: string | null }> = [];
    for (const newPaymentId of insertedPaymentIds) {
      const outcome = await tryAutoIssueReceiptForPayment(supabase, { paymentId: newPaymentId, actor });
      receiptOutcomes.push({
        skipped: outcome.skipped,
        reason: outcome.ok ? outcome.reason : outcome.reason,
        morningDocumentId: outcome.morningDocumentId,
      });
    }

    // Alert back-office (admin + office) that a new order came in.
    await notifyNewEntity({ kind: "order", entityId: orderId, creatorUserId: profile.id, customerId });

    return NextResponse.json({
      order_id: orderId,
      payment_status: derivedPaymentStatus,
      total_paid: totalPaid,
      payment_ids: insertedPaymentIds,
      morning_auto_invoice: {
        skipped: invoiceOutcome.skipped,
        reason: invoiceOutcome.ok ? invoiceOutcome.reason : invoiceOutcome.reason,
        morning_document_id: invoiceOutcome.morningDocumentId,
      },
      morning_auto_receipts: receiptOutcomes,
    });
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
