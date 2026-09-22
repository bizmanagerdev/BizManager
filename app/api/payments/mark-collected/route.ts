import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { derivePaymentStatus, splitPaymentAmounts } from "@/lib/orders/paymentStatus";

// Flip a pending (future-dated / uncleared) payment to 'cleared' when the money
// actually arrives — or back to 'pending' to undo. Keeps the stored
// orders.payment_status in sync (collected-based) so the order no longer shows
// as שולם purely on the strength of an expected payment.
//
// `account_id` is optional and only for the moment of collection: a check is
// recorded with the account it is MEANT to be deposited into, and the deposit
// itself is where that can still change. Sent only when it differs, and never
// on an undo.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { id?: string; collected?: boolean; account_id?: string | null };
    const paymentId = typeof body.id === "string" ? body.id.trim() : "";
    const markCollected = body.collected !== false; // default true
    if (!paymentId) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const accountId = typeof body.account_id === "string" && body.account_id.trim() ? body.account_id.trim() : null;
    if (accountId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) {
      return NextResponse.json({ error: "מזהה החשבון אינו תקין." }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const { data: existing, error: existingError } = await supabase
      .from("payments")
      .select("id,order_id,project_id,payment_status,account_id")
      .eq("id", paymentId)
      .maybeSingle();

    if (existingError) return NextResponse.json({ error: toHebrewError(existingError.message) }, { status: 400 });
    if (!existing?.id) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

    const nextStatus = markCollected ? "cleared" : "pending";
    // The account only ever moves WITH a collection, never on an undo.
    const movesAccount = markCollected && accountId !== null && accountId !== existing.account_id;
    const { error: updateError } = await supabase
      .from("payments")
      .update(movesAccount ? { payment_status: nextStatus, account_id: accountId } : { payment_status: nextStatus })
      .eq("id", paymentId);

    if (updateError) return NextResponse.json({ error: toHebrewError(updateError.message) }, { status: 400 });

    await logAuditEvent({
      supabase,
      tableName: "payments",
      recordId: paymentId,
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
      oldData: movesAccount
        ? { payment_status: existing.payment_status, account_id: existing.account_id }
        : { payment_status: existing.payment_status },
      newData: movesAccount ? { payment_status: nextStatus, account_id: accountId } : { payment_status: nextStatus },
    });

    // Keep the stored order status consistent with collected money.
    let orderPaymentStatus: string | null = null;
    if (existing.order_id) {
      const [{ data: rows }, { data: order }] = await Promise.all([
        supabase
          .from("payments")
          .select("amount_total,payment_status,due_date")
          .eq("order_id", existing.order_id),
        supabase.from("orders").select("total_amount").eq("id", existing.order_id).maybeSingle(),
      ]);
      const { collected } = splitPaymentAmounts(rows ?? []);
      const totalAmount =
        typeof order?.total_amount === "number" ? order.total_amount : Number(order?.total_amount ?? 0);
      orderPaymentStatus = derivePaymentStatus(totalAmount, collected);
      await supabase
        .from("orders")
        .update({ payment_status: orderPaymentStatus })
        .eq("id", existing.order_id);
    }

    return NextResponse.json({ ok: true, payment_status: nextStatus, order_payment_status: orderPaymentStatus });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
