import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { tryAutoIssueReceiptForPayment } from "@/lib/morning/service";
import { buildPaymentInsert, PAYMENT_SELECT } from "@/lib/payments";
import {
  derivePaymentStatus,
  normalizePaymentEntries,
  sumPayments,
} from "@/lib/orders/paymentStatus";

type CreateOrderPaymentPayload = {
  order_id?: string;
  payment_date?: string | null;
  amount_total?: number | string;
  payment_method?: string;
  due_date?: string | null;
  reference_number?: string;
  check_number?: string;
  notes?: string;
  entry_type?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateOrderPaymentPayload;
    const orderId = typeof body.order_id === "string" ? body.order_id : "";
    const [payment] = normalizePaymentEntries([body]);
    const entryType = body.entry_type === "refund" ? "refund" : "payment";
    const dueDate = typeof body.due_date === "string" && body.due_date.trim() ? body.due_date.trim() : null;

    if (!orderId) {
      return NextResponse.json({ error: "Missing order_id" }, { status: 400 });
    }
    if (
      !payment ||
        !Number.isFinite(payment.amount_total) ||
        payment.amount_total <= 0 ||
        !payment.payment_date ||
        !payment.payment_method
    ) {
      return NextResponse.json(
        { error: "Missing payment amount, date, or method" },
        { status: 400 }
      );
    }
    if (payment.payment_method === "check" && !dueDate) {
      return NextResponse.json({ error: "יש להזין תאריך פירעון לצ'ק" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,total_amount")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) return NextResponse.json({ error: orderError.message }, { status: 400 });
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const signedAmount = entryType === "refund" ? payment.amount_total * -1 : payment.amount_total;
    const notePrefix = entryType === "refund" ? "Refund" : "";

    const { data: createdPayment, error: paymentError } = await supabase
      .from("payments")
      .insert({
        ...buildPaymentInsert({
          amountTotal: signedAmount,
          businessDomain: "sales",
          orderId,
          paymentDate: payment.payment_date!,
          paymentMethod: payment.payment_method!,
          dueDate: payment.payment_method === "check" ? dueDate : null,
          referenceNumber: payment.reference_number,
          checkNumber: payment.payment_method === "check" ? payment.check_number : null,
          notes: payment.notes ? (notePrefix ? `${notePrefix}: ${payment.notes}` : payment.notes) : notePrefix || null,
          recordedBy: user.id,
        }),
      })
      .select(PAYMENT_SELECT)
      .maybeSingle();

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
      .select("amount_total")
      .eq("order_id", orderId);

    if (paymentsError) {
      return NextResponse.json({ error: paymentsError.message }, { status: 400 });
    }

    const totalPaid = sumPayments(paymentRows ?? []);
    const totalAmount = typeof order.total_amount === "number" ? order.total_amount : Number(order.total_amount ?? 0);
    const paymentStatus = derivePaymentStatus(totalAmount, totalPaid);

    const { error: updateError } = await supabase
      .from("orders")
      .update({ payment_status: paymentStatus })
      .eq("id", orderId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    // Best-effort Morning auto-receipt. Refunds (negative amounts) skip themselves
    // inside tryAutoIssueReceiptForPayment via the non_positive_amount short-circuit.
    let morningAutoReceipt: {
      skipped: boolean;
      reason: string | null;
      morning_document_id: string | null;
    } | null = null;
    if (createdPayment?.id) {
      const outcome = await tryAutoIssueReceiptForPayment(supabase, {
        paymentId: createdPayment.id,
        actor: { profileId: profile.id, authUserId: user.id, role: profile.role },
      });
      morningAutoReceipt = {
        skipped: outcome.skipped,
        reason: outcome.ok ? outcome.reason : outcome.reason,
        morning_document_id: outcome.morningDocumentId,
      };
    }

    return NextResponse.json({
      payment: createdPayment,
      payment_status: paymentStatus,
      total_paid: totalPaid,
      remaining_balance: Math.max(totalAmount - totalPaid, 0),
      morning_auto_receipt: morningAutoReceipt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
