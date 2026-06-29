import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type UpdateMovementPayload = {
  id?: string;
  quantity?: number | string;
  direction?: "in" | "out";
  notes?: string | null;
};

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

// Edit a manual stock-adjustment row (e.g. fix one mislabeled as "החזרת לקוח").
// Only manual_adjustment movements are editable — order-derived movements are
// owned by their order and must never be hand-edited here. The inventory table
// re-syncs automatically via trg_sync_inventory_from_movements (reverts the old
// effect, applies the new one) on the UPDATE.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as UpdateMovementPayload;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const direction = body.direction === "out" ? "out" : "in";
    const quantity = toNumber(body.quantity);
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;

    if (!id) {
      return NextResponse.json({ error: "חסר מזהה תנועה." }, { status: 400 });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "יש להזין כמות תקינה." }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data: existing, error: readError } = await supabase
      .from("inventory_movements")
      .select("id,product_id,source_type")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      return NextResponse.json({ error: `שגיאה בקריאת תנועת המלאי: ${readError.message}` }, { status: 400 });
    }
    if (!existing) {
      return NextResponse.json({ error: "תנועת המלאי לא נמצאה." }, { status: 404 });
    }
    if (existing.source_type !== "manual_adjustment") {
      return NextResponse.json(
        { error: "ניתן לערוך רק תנועות התאמת מלאי ידניות. תנועות שמקורן בהזמנה מתעדכנות דרך ההזמנה." },
        { status: 400 }
      );
    }

    const productId = typeof existing.product_id === "string" ? existing.product_id : "";

    const { data: movement, error: updateError } = await supabase
      .from("inventory_movements")
      .update({
        movement_type: direction,
        quantity,
        notes: notes || `Manual ${direction} adjustment`,
      })
      .eq("id", id)
      .eq("source_type", "manual_adjustment")
      .select("id,product_id,movement_type,quantity,source_type,source_id,performed_by,notes,created_at")
      .maybeSingle();

    if (updateError) {
      // The sync trigger blocks edits that would drive on-hand negative.
      const message = /Inventory cannot be negative/i.test(updateError.message)
        ? "העריכה תגרום למלאי שלילי. צמצמו את הכמות או שנו את כיוון התנועה."
        : `שגיאה בעדכון תנועת המלאי: ${updateError.message}`;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { data: updatedInv } = await supabase
      .from("inventory")
      .select("product_id,quantity_on_hand,quantity_reserved")
      .eq("product_id", productId)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      movement,
      inventory: updatedInv ?? null,
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "שגיאה לא ידועה");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
