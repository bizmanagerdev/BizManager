import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { currencyPricing, type MoneyCurrencyBody } from "@/lib/fx/money-input";

// Update a payment promise: mark kept/broken/cancelled, or edit amount/date/notes.
//
// Back as a route (it had moved to a direct browser write): a promise marked
// kept on a phone with no signal has to wait in the send queue like every
// other save (lib/offline-queue.ts). The direct write simply failed, and the
// undo engine then put the old status back — the tap undid itself.
export async function POST(req: Request) {
  try {
    // An amount with its currency (2026-10-25) is in that currency; without one,
    // shekels — a promise in US$ / C$ then keeps its rate, its dollars following.
    const body = (await req.json().catch(() => ({}))) as MoneyCurrencyBody & {
      id?: string;
      status?: string;
      amount?: number | string;
      promised_date?: string;
      notes?: string;
    };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return NextResponse.json({ error: "חסר מזהה הבטחה." }, { status: 400 });

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const updates: Record<string, unknown> = { updated_by: profile.id, updated_at: new Date().toISOString() };
    if (typeof body.status === "string" && ["pending", "kept", "broken", "cancelled"].includes(body.status)) {
      updates.status = body.status;
    }
    if (typeof body.promised_date === "string" && body.promised_date.trim()) {
      updates.promised_date = body.promised_date.trim();
    }
    if (body.amount !== undefined) {
      const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
      if (Number.isFinite(amount) && amount > 0) {
        const day = typeof updates.promised_date === "string" ? updates.promised_date : null;
        const pricing = await currencyPricing(supabase, body, { amount, date: day });
        if ("error" in pricing) return NextResponse.json({ error: pricing.error }, { status: 400 });
        updates.amount = pricing.toShekels(amount);
        Object.assign(updates, pricing.columns ?? {});
      }
    }
    if (typeof body.notes === "string") {
      updates.notes = body.notes.trim() || null;
    }

    const { data, error } = await supabase.from("payment_promises").update(updates).eq("id", id).select("id");
    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "ההבטחה לא נמצאה או שאין הרשאה לעדכן אותה." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "עדכון ההבטחה נכשל.") }, { status: 500 });
  }
}
