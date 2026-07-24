import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import {
  findOrderCommentIndex,
  parseOrderComments,
  serializeOrderComments,
  type OrderComment,
} from "@/lib/orders/comments";

/**
 * Edit one comment on an order. Comments live as a small text log inside the
 * order's `notes` field (no schema change): read notes, locate the target
 * comment by content, replace its body, and write the log back.
 */
export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const body = (await req.json()) as {
      order_id?: string;
      target?: OrderComment;
      message?: string;
    };
    const orderId = typeof body.order_id === "string" ? body.order_id : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const target = body.target;

    if (!orderId || !message || !target) {
      return NextResponse.json({ error: "Missing order_id, target or message" }, { status: 400 });
    }

    const { data: orderRow, error: readError } = await supabase
      .from("orders")
      .select("notes")
      .eq("id", orderId)
      .maybeSingle();

    if (readError) return NextResponse.json({ error: toHebrewError(readError.message) }, { status: 400 });
    if (!orderRow) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const comments = parseOrderComments(
      typeof (orderRow as { notes?: unknown }).notes === "string" ? (orderRow as { notes: string }).notes : ""
    );
    const index = findOrderCommentIndex(comments, target);
    if (index === -1) {
      return NextResponse.json({ error: "התגובה כבר עודכנה. רעננו ונסו שוב." }, { status: 409 });
    }

    const updated: OrderComment = { ...comments[index], body: message };
    const nextComments = comments.map((comment, i) => (i === index ? updated : comment));
    const nextNotes = serializeOrderComments(nextComments);

    const { error: updateError } = await supabase
      .from("orders")
      .update({ notes: nextNotes })
      .eq("id", orderId);

    if (updateError) return NextResponse.json({ error: toHebrewError(updateError.message) }, { status: 400 });

    return NextResponse.json({ ok: true, comment: updated });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
