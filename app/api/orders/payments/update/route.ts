import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { buildPaymentInsert, PAYMENT_SELECT } from "@/lib/payments";
import { derivePaymentStatus, sumPayments } from "@/lib/orders/paymentStatus";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: string;
      order_id?: string;
      payment_date?: string | null;
      due_date?: string | null;
      amount_total?: number | string;
      payment_method?: string;
      reference_number?: string | null;
      notes?: string | null;
    };

    const paymentId = typeof body.id === "string" ? body.id.trim() : "";
    const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
    const paymentDate = typeof body.payment_date === "string" ? body.payment_date.trim() : null;
    const dueDate = typeof body.due_date === "string" && body.due_date.trim() ? body.due_date.trim() : null;
    const paymentMethod = typeof body.payment_method === "string" ? body.payment_method.trim() : "";
    const referenceNumber = typeof body.reference_number === "string" ? body.reference_number.trim() || null : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
    const amountNumber = typeof body.amount_total === "number" ? body.amount_total : Number(body.amount_total);

    if (!paymentId || !orderId) {
      return NextResponse.json({ error: "Missing id or order_id" }, { status: 400 });
    }
    if (!Number.isFinite(amountNumber) || amountNumber === 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    if (!paymentDate || !paymentMethod) {
      return NextResponse.json({ error: "Missing payment_date or payment_method" }, { status: 400 });
    }
    if (paymentMethod === "check" && !dueDate) {
      return NextResponse.json({ error: "יש להזין תאריך פירעון לצ'ק" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    const { data: existing, error: existingError } = await supabase
      .from("payments")
      .select("id,order_id,project_id,property_id,business_domain")
      .eq("id", paymentId)
      .maybeSingle();

    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 400 });
    if (!existing?.id || existing.order_id !== orderId) {
      return NextResponse.json({ error: "Payment not found for order" }, { status: 404 });
    }

    const { recorded_by: _ignored, ...paymentValues } = buildPaymentInsert({
      amountTotal: amountNumber,
      businessDomain: "sales",
      orderId,
      projectId: existing.project_id ?? undefined,
      propertyId: existing.property_id ?? undefined,
      paymentDate,
      paymentMethod,
      dueDate: paymentMethod === "check" ? dueDate : null,
      referenceNumber,
      notes,
      recordedBy: user.id,
    });
    void _ignored;

    const { data: updatedPayment, error: updateError } = await supabase
      .from("payments")
      .update(paymentValues)
      .eq("id", paymentId)
      .select(PAYMENT_SELECT)
      .maybeSingle();

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 });

    if (updatedPayment?.id) {
      await logAuditEvent({
        supabase,
        tableName: "payments",
        recordId: updatedPayment.id,
        action: "update",
        changedBy: profile.id,
        userRole: profile.role,
      });
    }

    const { data: paymentRows } = await supabase
      .from("payments")
      .select("amount_total")
      .eq("order_id", orderId);

    const { data: order } = await supabase
      .from("orders")
      .select("total_amount")
      .eq("id", orderId)
      .maybeSingle();

    const totalPaid = sumPayments(paymentRows ?? []);
    const totalAmount =
      typeof order?.total_amount === "number"
        ? order.total_amount
        : Number(order?.total_amount ?? 0);
    const paymentStatus = derivePaymentStatus(totalAmount, totalPaid);

    await supabase.from("orders").update({ payment_status: paymentStatus }).eq("id", orderId);

    return NextResponse.json({ payment: updatedPayment, payment_status: paymentStatus, total_paid: totalPaid });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
