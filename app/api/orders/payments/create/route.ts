import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { tryAutoIssueReceiptForPayment } from "@/lib/morning/service";
import { runAfterResponse } from "@/lib/after-response";
import { PAYMENT_SELECT } from "@/lib/payments";
import { derivePaymentStatus, splitPaymentAmounts } from "@/lib/orders/paymentStatus";
import { orderPaymentFrom, type OrderPaymentBody } from "@/lib/orders/order-payment-input";
import { clientRowId } from "@/lib/client-row-id";

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    return await withIdempotency(req, supabase, user.id, "orders/payments/create", async () => {
    const body = (await req.json()) as OrderPaymentBody;
    // The row — built the same way the phone builds it (lib/orders/order-payment-input.ts).
    const built = orderPaymentFrom(body, user.id);
    if ("error" in built) return NextResponse.json({ error: built.error }, { status: 400 });
    const { orderId, entryType, row } = built;
    // A payment saved on the phone first comes with the app's own id (lib/powersync/local-writes.ts).
    const clientId = clientRowId(body.id);

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,total_amount")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) return NextResponse.json({ error: toHebrewError(orderError.message) }, { status: 400 });
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const { data: createdPayment, error: paymentError } = await supabase
      .from("payments")
      .insert({ ...(clientId ? { id: clientId } : {}), ...row })
      .select(PAYMENT_SELECT)
      .maybeSingle();

    if (paymentError && clientId && paymentError.code === "23505") {
      // Sent again after its answer was lost: the payment it already made (its
      // receipt was issued the first time).
      const [{ data: existing }, { data: rows }] = await Promise.all([
        supabase.from("payments").select(PAYMENT_SELECT).eq("id", clientId).maybeSingle(),
        supabase.from("payments").select("amount_total,payment_status,due_date").eq("order_id", orderId),
      ]);
      if (existing) {
        const { collected } = splitPaymentAmounts(rows ?? []);
        const total = typeof order.total_amount === "number" ? order.total_amount : Number(order.total_amount ?? 0);
        return NextResponse.json({
          payment: existing,
          payment_status: derivePaymentStatus(total, collected),
          total_paid: collected,
          remaining_balance: Math.max(total - collected, 0),
        });
      }
    }

    if (paymentError) {
      const message =
        (paymentError.message.includes("payments_amount_total_check") ||
          paymentError.message.includes("payments_net_amount_check") ||
          paymentError.message.includes("payments_amount_before_vat_check")) &&
        entryType === "refund"
          ? "הטבלה payments עדיין לא מאפשרת החזרים. יש להריץ db/sql/allow_order_refunds_in_payments.sql"
          : paymentError.message;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { data: paymentRows, error: paymentsError } = await supabase
      .from("payments")
      .select("amount_total,payment_status,due_date")
      .eq("order_id", orderId);

    if (paymentsError) {
      return NextResponse.json({ error: toHebrewError(paymentsError.message) }, { status: 400 });
    }

    // Status reflects COLLECTED money only — a future-dated / uncleared payment
    // (payment_status='pending') must NOT mark the order as שולם.
    const { collected: totalPaid } = splitPaymentAmounts(paymentRows ?? []);
    const totalAmount = typeof order.total_amount === "number" ? order.total_amount : Number(order.total_amount ?? 0);
    const paymentStatus = derivePaymentStatus(totalAmount, totalPaid);

    const { error: updateError } = await supabase
      .from("orders")
      .update({ payment_status: paymentStatus })
      .eq("id", orderId);

    if (updateError) {
      return NextResponse.json({ error: toHebrewError(updateError.message) }, { status: 400 });
    }

    // Best-effort Morning auto-receipt, after the response (an external API call
    // when auto-receipt is on). Refunds (negative amounts) skip themselves inside
    // tryAutoIssueReceiptForPayment via the non_positive_amount short-circuit; a
    // failure is still recorded (morning_auto_receipt_failed audit).
    if (createdPayment?.id) {
      const paymentId = createdPayment.id;
      const actor = { profileId: profile.id, authUserId: user.id, role: profile.role };
      runAfterResponse("orders/payments/create Morning receipt", () =>
        tryAutoIssueReceiptForPayment(supabase, { paymentId, actor })
      );
    }

    return NextResponse.json({
      payment: createdPayment,
      payment_status: paymentStatus,
      total_paid: totalPaid,
      remaining_balance: Math.max(totalAmount - totalPaid, 0),
    });
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
