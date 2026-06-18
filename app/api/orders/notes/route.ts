import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

/** Lightweight update of an order's notes (the comments section on the order page). */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { order_id?: string; notes?: string | null };
    const orderId = typeof body.order_id === "string" ? body.order_id : "";
    if (!orderId) {
      return NextResponse.json({ error: "Missing order_id" }, { status: 400 });
    }
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { error } = await supabase
      .from("orders")
      .update({ notes: notes || null })
      .eq("id", orderId);

    if (error) {
      return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
