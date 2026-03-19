import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import {
  derivePaymentStatus,
  hasInvalidPaymentEntry,
  normalizePaymentEntries,
  sumPayments,
  validateRequestedPaymentStatus,
} from "@/lib/orders/paymentStatus";

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
  payment_status?: string;
  discount_amount?: number | string;
  notes?: string | null;
  payments?: {
    amount_total?: number | string;
    payment_date?: string | null;
    payment_method?: string | null;
    reference_number?: string | null;
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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateOrderPayload;

    const customerId = typeof body.customer_id === "string" ? body.customer_id : "";
    const orderDate = typeof body.order_date === "string" ? body.order_date : "";
    const status = "draft";
    const paymentStatus = typeof body.payment_status === "string" ? body.payment_status : "unpaid";
    const discountAmount = toNumber(body.discount_amount ?? 0);
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
      quantity_ordered: toNumber(item.quantity_ordered),
      unit_price: toNumber(item.unit_price),
      discount_amount: toNumber(item.discount_amount ?? 0),
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
    const { supabase, user } = access.value;

    const subtotal = normalizedItems.reduce(
      (sum, item) => sum + item.quantity_ordered * item.unit_price - item.discount_amount,
      0
    );
    const totalAmount = subtotal - discountAmount;
    const totalPaid = sumPayments(payments);

    const requestedPaymentStatusError = validateRequestedPaymentStatus({
      requestedStatus: paymentStatus,
      totalAmount,
      paidAmount: totalPaid,
    });
    if (requestedPaymentStatusError) {
      return NextResponse.json({ error: requestedPaymentStatusError }, { status: 400 });
    }

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

    if (payments.length > 0) {
      const { error: paymentsInsertError } = await supabase.from("payments").insert(
        payments.map((payment) => ({
          target_type: "order",
          target_id: orderId,
          payment_date: payment.payment_date,
          amount_total: payment.amount_total,
          payment_method: payment.payment_method,
          reference_number: payment.reference_number,
          vat_amount: 0,
          amount_before_vat: payment.amount_total,
          net_amount: payment.amount_total,
          notes: payment.notes,
          recorded_by: user.id,
        }))
      );

      if (paymentsInsertError) {
        return NextResponse.json({ error: paymentsInsertError.message }, { status: 400 });
      }
    }

    const derivedPaymentStatus = derivePaymentStatus(totalAmount, totalPaid);
    const { error: updateError } = await supabase
      .from("orders")
      .update({ payment_status: derivedPaymentStatus })
      .eq("id", orderId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({
      order_id: orderId,
      payment_status: derivedPaymentStatus,
      total_paid: totalPaid,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
