import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type AdjustInventoryPayload = {
  product_id?: string;
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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AdjustInventoryPayload;
    const productId = typeof body.product_id === "string" ? body.product_id.trim() : "";
    const direction = body.direction === "out" ? "out" : "in";
    const quantity = toNumber(body.quantity);
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;

    if (!productId) {
      return NextResponse.json({ error: "יש לבחור מוצר." }, { status: 400 });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "יש להזין כמות תקינה." }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    const { data: existingInv, error: invReadError } = await supabase
      .from("inventory")
      .select("product_id,quantity_on_hand,quantity_reserved")
      .eq("product_id", productId)
      .maybeSingle();

    if (invReadError) {
      return NextResponse.json({ error: `שגיאה בקריאת מלאי: ${invReadError.message}` }, { status: 400 });
    }

    const currentOnHand =
      typeof existingInv?.quantity_on_hand === "number"
        ? existingInv.quantity_on_hand
        : typeof existingInv?.quantity_on_hand === "string"
          ? Number(existingInv.quantity_on_hand)
          : 0;
    const currentReserved =
      typeof existingInv?.quantity_reserved === "number"
        ? existingInv.quantity_reserved
        : typeof existingInv?.quantity_reserved === "string"
          ? Number(existingInv.quantity_reserved)
          : 0;
    const currentAvailable = currentOnHand - currentReserved;

    if (direction === "out" && currentAvailable < quantity) {
      return NextResponse.json(
        { error: "אין מספיק מלאי זמין להפחתה בכמות זו (מלאי זמין = מלאי נוכחי פחות שמור)." },
        { status: 400 }
      );
    }

    const { data: movement, error: movementError } = await supabase
      .from("inventory_movements")
      .insert({
        product_id: productId,
        movement_type: direction,
        quantity,
        source_type: "manual_adjustment",
        source_id: productId,
        performed_by: user.id,
        notes: notes || `Manual ${direction} adjustment`,
      })
      .select("*")
      .maybeSingle();

    if (movementError) {
      return NextResponse.json({ error: `שגיאה ברישום תנועת מלאי: ${movementError.message}` }, { status: 400 });
    }

    // After movement insert, inventory should be updated by DB trigger.
    const { data: updatedInv, error: invAfterError } = await supabase
      .from("inventory")
      .select("product_id,quantity_on_hand,quantity_reserved")
      .eq("product_id", productId)
      .maybeSingle();

    if (invAfterError) {
      return NextResponse.json(
        { error: `התנועה נרשמה אך לא ניתן לקרוא מלאי מעודכן: ${invAfterError.message}` },
        { status: 400 }
      );
    }

    const reserved =
      typeof updatedInv?.quantity_reserved === "number"
        ? updatedInv.quantity_reserved
        : typeof updatedInv?.quantity_reserved === "string"
          ? Number(updatedInv.quantity_reserved)
          : 0;
    const onHand =
      typeof updatedInv?.quantity_on_hand === "number"
        ? updatedInv.quantity_on_hand
        : typeof updatedInv?.quantity_on_hand === "string"
          ? Number(updatedInv.quantity_on_hand)
          : currentOnHand + (direction === "in" ? quantity : -quantity);

    return NextResponse.json({
      success: true,
      movement,
      inventory: {
        product_id: productId,
        quantity_on_hand: onHand,
        quantity_reserved: Number.isFinite(reserved) ? reserved : 0,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
