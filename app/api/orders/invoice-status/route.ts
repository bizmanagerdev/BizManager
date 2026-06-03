import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type Payload = {
  order_id?: string;
  // null clears the choice (undecided); boolean sets it.
  needs_invoice?: boolean | null;
  // Quick toggle: true → stamp invoice_sent_at = now(); false → clear it.
  invoice_sent?: boolean;
  // Explicit issued date (allows backdating). Takes precedence over invoice_sent.
  // ISO date string, or null to clear.
  invoice_sent_at?: string | null;
  // ISO date string, or null to clear.
  delivery_confirmed_at?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
    if (!orderId) {
      return NextResponse.json({ error: "Missing order_id" }, { status: 400 });
    }

    const update: Record<string, unknown> = {};
    if ("needs_invoice" in body) {
      update.needs_invoice = typeof body.needs_invoice === "boolean" ? body.needs_invoice : null;
    }
    if ("invoice_sent_at" in body) {
      const value = body.invoice_sent_at;
      update.invoice_sent_at = typeof value === "string" && value.trim() ? value.trim() : null;
    } else if ("invoice_sent" in body) {
      update.invoice_sent_at = body.invoice_sent ? new Date().toISOString() : null;
    }
    if ("delivery_confirmed_at" in body) {
      const value = body.delivery_confirmed_at;
      update.delivery_confirmed_at =
        typeof value === "string" && value.trim() ? value.trim() : null;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { error } = await supabase.from("orders").update(update).eq("id", orderId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
