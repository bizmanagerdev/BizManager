import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import {
  tryAutoIssueInvoiceForOrder,
  tryAutoIssueReceiptForPayment,
} from "@/lib/morning/service";
import { buildPaymentInsert } from "@/lib/payments";
import {
  derivePaymentStatus,
  hasInvalidPaymentEntry,
  normalizePaymentEntries,
  sumPayments,
} from "@/lib/orders/paymentStatus";
import { computeDueDate, normalizePaymentTerms } from "@/lib/paymentTerms";

type CreateOrderItemPayload = {
  product_id?: string;
  quantity_ordered?: number | string;
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
  discount_amount?: number | string;
  needs_invoice?: boolean | null;
  notes?: string | null;
  payments?: {
    amount_total?: number | string;
    payment_date?: string | null;
    payment_method?: string | null;
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
      return NextResponse.json({ error: "Missing required order fields" }, { status: 400 });
    }
    if (!Number.isFinite(discountAmount) || discountAmount < 0) {
      return NextResponse.json({ error: "Invalid discount amount" }, { status: 400 });
    }
    if (hasInvalidPaymentEntry(payments)) {
      return NextResponse.json({ error: "Invalid payment payload" }, { status: 400 });
    }

    const normalizedItems = items.map((item) => ({
      product_id: typeof item.product_id === "string" ? item.product_id : "",
      quantity_ordered: toPositiveInt(item.quantity_ordered),
      unit_price: toNonNegativeInt(item.unit_price),
      discount_amount: toNonNegativeInt(item.discount_amount ?? 0),
      notes: typeof item.notes === "string" ? item.notes.trim() : null,
    }));

    const invalidItem = normalizedItems.find(
      (item) =>
        !item.product_id ||
        !Number.isFinite(item.quantity_ordered) ||
        item.quantity_ordered <= 0 ||
        !Number.isFinite(item.unit_price) ||
        item.unit_price < 0 ||
        !Number.isFinite(item.discount_amount) ||
        item.discount_amount < 0
    );
    if (invalidItem) {
      return NextResponse.json({ error: "Invalid order item payload" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    const subtotal = normalizedItems.reduce(
      (sum, item) => sum + item.quantity_ordered * item.unit_price - item.discount_amount,
      0
    );
    const totalAmount = subtotal - discountAmount;
    const totalPaid = sumPayments(payments);
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("requires_prepayment")
      .eq("id", customerId)
      .maybeSingle();

    if (customerError) {
      return NextResponse.json({ error: customerError.message }, { status: 400 });
    }
    if (customer?.requires_prepayment === true && totalPaid + 0.009 < totalAmount) {
      return NextResponse.json(
        { error: "Customer requires prepayment. Collect full payment before creating the order." },
        { status: 400 }
      );
    }

    const paymentStatus = derivePaymentStatus(totalAmount, totalPaid);

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
    });

    if (error) {
      const hint =
        error.message.includes("create_sales_order") || error.message.includes("function")
          ? "Missing DB function create_sales_order. Run db/sql/create_sales_order_rpc.sql"
          : error.message;
      return NextResponse.json({ error: hint }, { status: 400 });
    }

    const orderId = typeof data === "string" ? data : null;
    if (!orderId) return NextResponse.json({ error: "Failed to create order" }, { status: 500 });

    const insertedPaymentIds: string[] = [];
    if (payments.length > 0) {
      const { data: insertedPaymentRows, error: paymentsInsertError } = await supabase
        .from("payments")
        .insert(
          payments.map((payment) => ({
            ...buildPaymentInsert({
              amountTotal: payment.amount_total,
              businessDomain: "sales",
              orderId,
              paymentDate: payment.payment_date!,
              paymentMethod: payment.payment_method!,
              dueDate: payment.due_date,
              referenceNumber: payment.reference_number,
              checkNumber: payment.payment_method === "check" ? payment.check_number : null,
              notes: payment.notes,
              recordedBy: user.id,
            }),
          }))
        )
        .select("id");

      if (paymentsInsertError) {
        return NextResponse.json({ error: paymentsInsertError.message }, { status: 400 });
      }
      for (const row of insertedPaymentRows ?? []) {
        if (row && typeof (row as { id?: unknown }).id === "string") {
          insertedPaymentIds.push((row as { id: string }).id);
        }
      }
    }

    const derivedPaymentStatus = derivePaymentStatus(totalAmount, totalPaid);
    // Payment terms + the resulting due date. An explicit due_date overrides the
    // term-computed one; otherwise it's computed from order_date + the term.
    const paymentTerms = normalizePaymentTerms(body.payment_terms);
    const dueDate =
      typeof body.due_date === "string" && body.due_date.trim()
        ? body.due_date.trim()
        : computeDueDate(orderDate, paymentTerms);
    const { error: updateError } = await supabase
      .from("orders")
      .update({
        payment_status: derivedPaymentStatus,
        payment_terms: paymentTerms,
        due_date: dueDate,
        needs_invoice: needsInvoice,
      })
      .eq("id", orderId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    // Best-effort Morning auto-issue on new order: invoice for the order, plus a
    // receipt for each upfront payment line. Failures never abort the create.
    const actor = { profileId: profile.id, authUserId: user.id, role: profile.role };
    const invoiceOutcome = await tryAutoIssueInvoiceForOrder(supabase, {
      orderId,
      newStatus: status,
      trigger: "create",
      actor,
    });

    const receiptOutcomes: Array<{ skipped: boolean; reason: string | null; morningDocumentId: string | null }> = [];
    if (payments.length > 0) {
      const { data: newPaymentRows } = await supabase
        .from("payments")
        .select("id,created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false })
        .limit(payments.length);
      const newPaymentIds = ((newPaymentRows ?? []) as Array<{ id?: string }>)
        .map((row) => (typeof row?.id === "string" ? row.id : null))
        .filter((value): value is string => Boolean(value));
      for (const newPaymentId of newPaymentIds) {
        const outcome = await tryAutoIssueReceiptForPayment(supabase, { paymentId: newPaymentId, actor });
        receiptOutcomes.push({
          skipped: outcome.skipped,
          reason: outcome.ok ? outcome.reason : outcome.reason,
          morningDocumentId: outcome.morningDocumentId,
        });
      }
    }

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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
