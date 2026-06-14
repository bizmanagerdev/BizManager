import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { resolveExistingCategoryId } from "@/lib/products/resolveCategoryId";

type CreateProductPayload = {
  name?: string;
  sku?: string | null;
  barcode?: string | null;
  category_id?: string | null;
  unit_price?: number | string | null;
  base_cost?: number | string | null;
  purchased_amount?: number | string | null;
  low_stock_threshold?: number | string | null;
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

function isMissingColumnError(error: unknown, columnName: string) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : null;
  const message = "message" in error ? error.message : null;
  return (
    code === "42703" &&
    typeof message === "string" &&
    message.toLowerCase().includes(columnName.toLowerCase())
  );
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    return await withIdempotency(req, supabase, user.id, "products/create", async () => {
    const body = (await req.json()) as CreateProductPayload;

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const sku = typeof body.sku === "string" ? body.sku.trim() : null;
    const barcode = typeof body.barcode === "string" ? body.barcode.trim() : null;
    const categoryId = typeof body.category_id === "string" ? body.category_id.trim() : null;
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const unitPriceRaw = body.unit_price;
    const baseCostRaw = body.base_cost;
    const purchasedAmountRaw = body.purchased_amount;
    const lowStockThresholdRaw = body.low_stock_threshold;
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
    const lowStockThreshold =
      lowStockThresholdRaw === undefined || lowStockThresholdRaw === null || lowStockThresholdRaw === ""
        ? 5
        : toNumber(lowStockThresholdRaw);

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

    if (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) {
      return NextResponse.json({ error: "סף מלאי נמוך אינו תקין." }, { status: 400 });
    }

    const categoryResult = await resolveExistingCategoryId(supabase, categoryId);
    if (categoryResult.categoryId === null) {
      return NextResponse.json(
        { error: `Product creation failed: could not resolve a product category. ${categoryResult.error}` },
        { status: 400 }
      );
    }

    const insertPayload: {
      name: string;
      sku: string | null;
      barcode: string | null;
      description: string | null;
      base_price: number;
      base_cost: number;
      active: boolean;
      category_id?: string;
      low_stock_threshold?: number;
    } = {
      name,
      sku: sku || null,
      barcode: barcode || null,
      description: description || null,
      base_price: unitPrice ?? 0,
      base_cost: baseCost ?? 0,
      active,
      low_stock_threshold: lowStockThreshold,
    };

    insertPayload.category_id = categoryResult.categoryId;

    let warning: string | null = null;
    let insertResult = await supabase
      .from("products")
      .insert(insertPayload)
      .select("id,name,sku,barcode,description,base_price,base_cost,active,category_id,low_stock_threshold")
      .maybeSingle();

    if (isMissingColumnError(insertResult.error, "low_stock_threshold")) {
      const { low_stock_threshold: removedLowStockThreshold, ...fallbackInsertPayload } = insertPayload;
      void removedLowStockThreshold;
      warning = "סף מלאי נמוך לא נשמר כי עדכון בסיס הנתונים עדיין לא הוחל.";
      insertResult = await supabase
        .from("products")
        .insert(fallbackInsertPayload)
        .select("id,name,sku,barcode,description,base_price,base_cost,active,category_id")
        .maybeSingle();
    }

    const { data, error } = insertResult;

    if (error) {
      return NextResponse.json({ error: `יצירת מוצר נכשלה: ${error.message}` }, { status: 400 });
    }
    if (!data || typeof data.id !== "string") {
      return NextResponse.json({ error: "יצירת מוצר נכשלה." }, { status: 400 });
    }

    if (purchasedAmount > 0) {
      const { error: movementError } = await supabase.from("inventory_movements").insert({
        product_id: data.id,
        movement_type: "in",
        quantity: purchasedAmount,
        source_type: "manual_product",
        source_id: data.id,
        performed_by: user.id,
        notes: "Initial purchased amount",
      });

      if (movementError) {
        return NextResponse.json(
          { error: `המוצר נוצר אך הוספת כמות שנרכשה נכשלה: ${movementError.message}` },
          { status: 400 }
        );
      }
    }

    let categoryName: string | null = null;
    if (typeof data.category_id === "string" && data.category_id) {
      const { data: categoryRow } = await supabase
        .from("product_categories")
        .select("name")
        .eq("id", data.category_id)
        .maybeSingle();
      categoryName = typeof categoryRow?.name === "string" ? categoryRow.name : null;
    }

    return NextResponse.json({ product: { ...data, category_name: categoryName }, warning });
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
