import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

const DEFAULT_PRODUCT_CATEGORY_ID = "18caa32d-3639-4c42-9b26-5ddcb5504fed";

type UpdateProductPayload = {
  id?: string;
  name?: string;
  sku?: string | null;
  barcode?: string | null;
  unit_price?: number | string | null;
  base_cost?: number | string | null;
  purchased_amount?: number | string | null;
  description?: string | null;
  active?: boolean;
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
    const body = (await req.json()) as UpdateProductPayload;

    const id = typeof body.id === "string" ? body.id.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const sku = typeof body.sku === "string" ? body.sku.trim() : null;
    const barcode = typeof body.barcode === "string" ? body.barcode.trim() : null;
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const unitPriceRaw = body.unit_price;
    const baseCostRaw = body.base_cost;
    const purchasedAmountRaw = body.purchased_amount;
    const active = typeof body.active === "boolean" ? body.active : true;

    const unitPrice =
      unitPriceRaw === undefined || unitPriceRaw === null || unitPriceRaw === ""
        ? null
        : toNumber(unitPriceRaw);
    const baseCost =
      baseCostRaw === undefined || baseCostRaw === null || baseCostRaw === ""
        ? null
        : toNumber(baseCostRaw);
    const purchasedAmount =
      purchasedAmountRaw === undefined || purchasedAmountRaw === null || purchasedAmountRaw === ""
        ? 0
        : toNumber(purchasedAmountRaw);

    if (!id) {
      return NextResponse.json({ error: "מזהה מוצר חסר." }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "שם מוצר הוא שדה חובה." }, { status: 400 });
    }
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      return NextResponse.json({ error: "מחיר מוצר אינו תקין." }, { status: 400 });
    }
    if (baseCost !== null && (!Number.isFinite(baseCost) || baseCost < 0)) {
      return NextResponse.json({ error: "עלות בסיס אינה תקינה." }, { status: 400 });
    }
    if (!Number.isFinite(purchasedAmount) || purchasedAmount < 0) {
      return NextResponse.json({ error: "כמות שנרכשה אינה תקינה." }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    const { data, error } = await supabase
      .from("products")
      .update({
        name,
        sku: sku || null,
        barcode: barcode || null,
        category_id: DEFAULT_PRODUCT_CATEGORY_ID,
        description: description || null,
        base_price: unitPrice ?? 0,
        base_cost: baseCost ?? 0,
        active,
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: `עדכון מוצר נכשל: ${error.message}` }, { status: 400 });
    }
    if (!data) {
      return NextResponse.json({ error: "עדכון מוצר נכשל." }, { status: 400 });
    }

    if (purchasedAmount > 0) {
      const { error: movementError } = await supabase.from("inventory_movements").insert({
        product_id: id,
        movement_type: "in",
        quantity: purchasedAmount,
        source_type: "manual_product",
        source_id: id,
        performed_by: user.id,
        notes: "Purchased amount update",
      });

      if (movementError) {
        return NextResponse.json(
          { error: `המוצר עודכן אך הוספת כמות שנרכשה נכשלה: ${movementError.message}` },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({ product: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

