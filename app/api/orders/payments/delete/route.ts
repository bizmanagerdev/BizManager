import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { derivePaymentStatus, splitPaymentAmounts } from "@/lib/orders/paymentStatus";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { id?: string; order_id?: string };
    const paymentId = typeof body.id === "string" ? body.id.trim() : "";
    const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";

    if (!paymentId || !orderId) {
      return NextResponse.json({ error: "Missing id or order_id" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const { data: existing, error: existingError } = await supabase
      .from("payments")
      .select("id,order_id")
      .eq("id", paymentId)
      .maybeSingle();

    if (existingError) return NextResponse.json({ error: toHebrewError(existingError.message) }, { status: 400 });
    if (!existing?.id || existing.order_id !== orderId) {
      return NextResponse.json({ error: "Payment not found for order" }, { status: 404 });
    }

    const { error: deleteError } = await supabase
      .from("payments")
      .delete()
      .eq("id", paymentId)
      .eq("order_id", orderId);

    if (deleteError) return NextResponse.json({ error: toHebrewError(deleteError.message) }, { status: 400 });

    await logAuditEvent({
      supabase,
      tableName: "payments",
      recordId: paymentId,
      action: "delete",
      changedBy: profile.id,
      userRole: profile.role,
    });

    const { data: paymentRows } = await supabase
      .from("payments")
      .select("amount_total,payment_status,due_date")
      .eq("order_id", orderId);

    const { data: order } = await supabase
      .from("orders")
      .select("total_amount")
      .eq("id", orderId)
      .maybeSingle();

    const { collected: totalPaid } = splitPaymentAmounts(paymentRows ?? []);
    const totalAmount =
      typeof order?.total_amount === "number"
        ? order.total_amount
        : Number(order?.total_amount ?? 0);
    const paymentStatus = derivePaymentStatus(totalAmount, totalPaid);

    await supabase.from("orders").update({ payment_status: paymentStatus }).eq("id", orderId);

    return NextResponse.json({ ok: true, payment_status: paymentStatus, total_paid: totalPaid });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
