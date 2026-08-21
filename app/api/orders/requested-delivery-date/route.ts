import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Lightweight, single-field update — set/change/clear the customer-requested
// delivery date on an ALREADY-EXISTING order (the calendar's "add a delivery"
// quick-create). Deliberately NOT the update_sales_order RPC: that one fully
// replaces order_items and recalculates inventory movements, which is
// pointless risk for changing one date.

type Payload = {
  order_id?: string;
  /** ISO date string (YYYY-MM-DD), or null to clear. */
  requested_delivery_date?: string | null;
  /** Who else should see this on THEIR calendar, beyond the order's creator
   *  and office/admin (who always see it). Omitted → recipients untouched;
   *  present (including []) → replaces the full set. */
  recipient_user_ids?: string[];
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
    if (!orderId) {
      return NextResponse.json({ error: "חסר מזהה הזמנה." }, { status: 400 });
    }
    const hasDate = "requested_delivery_date" in body;
    const hasRecipients = Array.isArray(body.recipient_user_ids);
    if (!hasDate && !hasRecipients) {
      return NextResponse.json({ error: "אין שדות לעדכון." }, { status: 400 });
    }

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    if (hasDate) {
      const value = body.requested_delivery_date;
      const requestedDeliveryDate = typeof value === "string" && value.trim() ? value.trim() : null;
      const { error } = await supabase
        .from("orders")
        .update({ requested_delivery_date: requestedDeliveryDate })
        .eq("id", orderId);
      if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    }

    if (hasRecipients) {
      const recipientIds = (body.recipient_user_ids ?? []).filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0
      );
      const { error: deleteError } = await supabase
        .from("order_delivery_recipients")
        .delete()
        .eq("order_id", orderId);
      if (deleteError) return NextResponse.json({ error: toHebrewError(deleteError.message) }, { status: 400 });

      if (recipientIds.length > 0) {
        const { error: insertError } = await supabase
          .from("order_delivery_recipients")
          .insert(recipientIds.map((userId) => ({ order_id: orderId, user_id: userId })));
        if (insertError) return NextResponse.json({ error: toHebrewError(insertError.message) }, { status: 400 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
