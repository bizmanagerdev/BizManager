import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";

// Save "how to actually reach this customer" — the arrival instructions and the
// drop-off pin. Deliberately its own endpoint rather than part of the customer
// update: a driver standing at the door saves a pin from their phone, and that
// shouldn't require the permission (or the payload) of editing a customer record.
//
// Every field is optional and only applied when present, so the confirm-delivery
// flow can save a pin without touching instructions, and vice versa.
// Read the saved arrival details for one customer. The confirm-delivery dialog
// needs them but its order payload doesn't carry them, and a tiny keyed read
// beats widening that payload for every caller.
export async function GET(req: Request) {
  try {
    const customerId = new URL(req.url).searchParams.get("customer_id")?.trim() ?? "";
    if (!customerId) return NextResponse.json({ error: "חסר מזהה לקוח." }, { status: 400 });

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;

    const { data } = await access.value.supabase
      .from("customers")
      .select("delivery_instructions,delivery_lat,delivery_lng")
      .eq("id", customerId)
      .maybeSingle();

    return NextResponse.json({
      instructions: (data as { delivery_instructions?: string | null } | null)?.delivery_instructions ?? null,
      lat: (data as { delivery_lat?: number | null } | null)?.delivery_lat ?? null,
      lng: (data as { delivery_lng?: number | null } | null)?.delivery_lng ?? null,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "טעינת פרטי ההגעה נכשלה.") }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      customer_id?: string;
      instructions?: string | null;
      lat?: number | null;
      lng?: number | null;
    };

    const customerId = typeof body.customer_id === "string" ? body.customer_id.trim() : "";
    if (!customerId) {
      return NextResponse.json({ error: "חסר מזהה לקוח." }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const patch: Record<string, string | number | null> = {};

    if (body.instructions !== undefined) {
      const text = typeof body.instructions === "string" ? body.instructions.trim() : "";
      patch.delivery_instructions = text || null;
    }

    // lat/lng move together — half a coordinate is not a location. Passing null
    // for both is how the UI clears a saved pin.
    if (body.lat !== undefined || body.lng !== undefined) {
      const lat = body.lat === null ? null : Number(body.lat);
      const lng = body.lng === null ? null : Number(body.lng);
      if (lat === null || lng === null) {
        patch.delivery_lat = null;
        patch.delivery_lng = null;
      } else if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      ) {
        return NextResponse.json({ error: "המיקום שהתקבל אינו תקין." }, { status: 400 });
      } else {
        patch.delivery_lat = lat;
        patch.delivery_lng = lng;
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "אין מה לעדכן." }, { status: 400 });
    }

    const { error } = await supabase.from("customers").update(patch).eq("id", customerId);
    if (error) {
      return NextResponse.json({ error: toHebrewError(error.message, "שמירת המיקום נכשלה.") }, { status: 400 });
    }

    await logAuditEvent({
      supabase,
      tableName: "customers",
      recordId: customerId,
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
      newData: patch,
    }).catch(() => {
      // Audit is best-effort — never fail the save because the log didn't write.
    });

    return NextResponse.json({ ok: true, ...patch });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שמירת המיקום נכשלה.") }, { status: 500 });
  }
}
