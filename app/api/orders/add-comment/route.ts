import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { appendOrderComment, formatOrderCommentTimestamp } from "@/lib/orders/comments";

/**
 * Add one comment to an order. Comments live as a small text log inside the
 * order's existing `notes` field (no schema change): read notes, append a
 * "<author> · <date>\n<body>" block, and write it back.
 */
export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    return await withIdempotency(req, supabase, user.id, "orders/add-comment", async () => {
      const body = (await req.json()) as { order_id?: string; message?: string };
      const orderId = typeof body.order_id === "string" ? body.order_id : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";

      if (!orderId || !message) {
        return NextResponse.json({ error: "Missing order_id or message" }, { status: 400 });
      }

      const { data: orderRow, error: readError } = await supabase
        .from("orders")
        .select("notes")
        .eq("id", orderId)
        .maybeSingle();

      if (readError) return NextResponse.json({ error: toHebrewError(readError.message) }, { status: 400 });
      if (!orderRow) return NextResponse.json({ error: "Order not found" }, { status: 404 });

      const authorName = profile.full_name ?? profile.email ?? null;
      const createdAt = formatOrderCommentTimestamp(new Date());
      const comment = { author_name: authorName, created_at: createdAt, body: message };

      const nextNotes = appendOrderComment(
        typeof (orderRow as { notes?: unknown }).notes === "string"
          ? ((orderRow as { notes: string }).notes)
          : "",
        comment
      );

      const { error: updateError } = await supabase
        .from("orders")
        .update({ notes: nextNotes })
        .eq("id", orderId);

      if (updateError) return NextResponse.json({ error: toHebrewError(updateError.message) }, { status: 400 });

      return NextResponse.json({ ok: true, comment });
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
