import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type CreateProductPayload = {
  name?: string;
  code?: string | null;
  unit_price?: number | string | null;
  stock?: number | string | null;
  notes?: string | null;
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

function isColumnError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("column") ||
    m.includes("schema cache") ||
    m.includes("could not find") ||
    m.includes("does not exist")
  );
}

function candidatePayloads(input: {
  name: string;
  code: string | null;
  unitPrice: number | null;
  stock: number | null;
  notes: string | null;
  active: boolean;
}) {
  const base = [
    { name: input.name },
    { product_name: input.name },
    { title: input.name },
  ] as Array<Record<string, unknown>>;

  const variants = [
    {
      codeField: "sku",
      priceField: "sale_price",
      stockField: "stock",
    },
    {
      codeField: "code",
      priceField: "price",
      stockField: "quantity",
    },
    {
      codeField: "barcode",
      priceField: "unit_price",
      stockField: "available_quantity",
    },
    {
      codeField: "sku",
      priceField: "selling_price",
      stockField: "in_stock",
    },
    {
      codeField: "sku",
      priceField: "retail_price",
      stockField: "stock",
    },
  ];

  const result: Array<Record<string, unknown>> = [];

  for (const b of base) {
    result.push({ ...b });
    for (const v of variants) {
      const payload: Record<string, unknown> = { ...b };
      if (input.code) payload[v.codeField] = input.code;
      if (input.unitPrice !== null) payload[v.priceField] = input.unitPrice;
      if (input.stock !== null) payload[v.stockField] = input.stock;
      payload.active = input.active;
      if (input.notes) payload.notes = input.notes;
      result.push(payload);
    }
  }

  return result;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateProductPayload;

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const unitPriceRaw = body.unit_price;
    const stockRaw = body.stock;
    const active = typeof body.active === "boolean" ? body.active : true;

    const unitPrice =
      unitPriceRaw === undefined || unitPriceRaw === null || unitPriceRaw === ""
        ? null
        : toNumber(unitPriceRaw);
    const stock =
      stockRaw === undefined || stockRaw === null || stockRaw === "" ? null : toNumber(stockRaw);

    if (!name) {
      return NextResponse.json({ error: "שם מוצר הוא שדה חובה." }, { status: 400 });
    }
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      return NextResponse.json({ error: "מחיר מוצר אינו תקין." }, { status: 400 });
    }
    if (stock !== null && !Number.isFinite(stock)) {
      return NextResponse.json({ error: "כמות מלאי אינה תקינה." }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    let lastError = "יצירת מוצר נכשלה.";
    for (const payload of candidatePayloads({ name, code, unitPrice, stock, notes, active })) {
      const { data, error } = await supabase.from("products").insert(payload).select("*").maybeSingle();
      if (!error && data) {
        return NextResponse.json({ product: data });
      }
      if (error && !isColumnError(error.message)) {
        return NextResponse.json({ error: `יצירת מוצר נכשלה: ${error.message}` }, { status: 400 });
      }
      if (error) lastError = error.message;
    }

    return NextResponse.json(
      { error: `יצירת מוצר נכשלה. בדקו את מבנה טבלת products. פירוט: ${lastError}` },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

