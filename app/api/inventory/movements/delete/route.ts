import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type DeleteMovementPayload = { id?: string };

// Delete a manual stock-adjustment row. Only manual_adjustment movements are
// deletable — order-derived movements belong to their order. The inventory
// table re-syncs automatically via trg_sync_inventory_from_movements (reverts
// the deleted movement's effect) on the DELETE.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as DeleteMovementPayload;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "חסר מזהה תנועה." }, { status: 400 });
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
        { error: "ניתן למחוק רק תנועות התאמת מלאי ידניות. תנועות שמקורן בהזמנה מתעדכנות דרך ההזמנה." },
        { status: 400 }
      );
    }

    const productId = typeof existing.product_id === "string" ? existing.product_id : "";

    const { error: deleteError } = await supabase
      .from("inventory_movements")
      .delete()
      .eq("id", id)
      .eq("source_type", "manual_adjustment");

    if (deleteError) {
      // The sync trigger blocks a delete that would drive on-hand negative
      // (e.g. removing an 'in' whose stock has since been sold out).
      const message = /Inventory cannot be negative/i.test(deleteError.message)
        ? "לא ניתן למחוק: המחיקה תגרום למלאי שלילי. עדכנו תחילה את המלאי."
        : `שגיאה במחיקת תנועת המלאי: ${deleteError.message}`;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { data: updatedInv } = await supabase
      .from("inventory")
      .select("product_id,quantity_on_hand,quantity_reserved")
      .eq("product_id", productId)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      product_id: productId,
      inventory: updatedInv ?? null,
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "שגיאה לא ידועה");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
