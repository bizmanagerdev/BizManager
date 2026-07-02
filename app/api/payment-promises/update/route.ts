import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Update a payment promise: mark kept/broken/cancelled, or edit amount/date/notes.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: string;
      status?: string;
      amount?: number | string;
      promised_date?: string;
      notes?: string;
    };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const updates: Record<string, unknown> = { updated_by: profile.id, updated_at: new Date().toISOString() };
    if (typeof body.status === "string" && ["pending", "kept", "broken", "cancelled"].includes(body.status)) {
      updates.status = body.status;
    }
    if (body.amount !== undefined) {
      const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
      if (Number.isFinite(amount) && amount > 0) updates.amount = amount;
    }
    if (typeof body.promised_date === "string" && body.promised_date.trim()) {
      updates.promised_date = body.promised_date.trim();
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
    return NextResponse.json({ error: toHebrewError(err, "Unknown error") }, { status: 500 });
  }
}
