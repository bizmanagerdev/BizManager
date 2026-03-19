import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type Row = Record<string, unknown>;

function getString(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function getNumber(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;

  const { supabase } = access.value;
  const { id } = await context.params;

  const [
    { data: customers, error: customersError },
    { data: products, error: productsError },
    { data: order, error: orderError },
    { data: orderItems, error: orderItemsError },
    { data: payments, error: paymentsError },
  ] = await Promise.all([
    supabase
      .from("customers")
      .select("id,name,name_for_invoice,registration_number,phone,email,address,active,notes")
      .limit(5000),
    supabase.from("products").select("*").limit(1000),
    supabase.from("orders").select("*").eq("id", id).maybeSingle(),
    supabase.from("order_items").select("*").eq("order_id", id).limit(500),
    supabase
      .from("payments")
      .select("id,payment_date,amount_total,payment_method,reference_number,notes")
      .eq("target_type", "order")
      .eq("target_id", id)
      .order("payment_date", { ascending: false }),
  ]);

  if (customersError) {
    return NextResponse.json({ error: customersError.message }, { status: 400 });
  }
  if (productsError) {
    return NextResponse.json({ error: productsError.message }, { status: 400 });
  }
  if (orderError) {
    return NextResponse.json({ error: orderError.message }, { status: 400 });
  }
  if (orderItemsError) {
    return NextResponse.json({ error: orderItemsError.message }, { status: 400 });
  }
  if (paymentsError) {
    return NextResponse.json({ error: paymentsError.message }, { status: 400 });
  }
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const productsById = new Map<string, Row>();
  (products ?? []).forEach((row) => {
    if (typeof row?.id === "string") productsById.set(row.id, row as Row);
  });

  const initialOrder = {
    id,
    customer_id: getString(order as Row, ["customer_id"]) ?? "",
    order_date: (getString(order as Row, ["order_date"]) ?? "").slice(0, 10),
    status: getString(order as Row, ["status"]) ?? "draft",
    payment_status: getString(order as Row, ["payment_status"]) ?? "unpaid",
    discount_amount: getNumber(order as Row, ["discount_amount"]) ?? 0,
    notes: getString(order as Row, ["notes"]) ?? "",
    items: (orderItems ?? []).map((item) => {
      const productId = getString(item as Row, ["product_id"]) ?? "";
      const product = productsById.get(productId) ?? {};
      return {
        product_id: productId,
        product_name:
          getString(product as Row, ["name", "product_name", "title", "sku"]) ?? productId,
        quantity_ordered: getNumber(item as Row, ["quantity_ordered"]) ?? 1,
        unit_price: getNumber(item as Row, ["unit_price"]) ?? 0,
        discount_amount: getNumber(item as Row, ["discount_amount"]) ?? 0,
        notes: getString(item as Row, ["notes"]) ?? "",
      };
    }),
  };

  const normalizedPayments = ((payments ?? []) as Row[]).map((payment) => ({
    id: getString(payment as Row, ["id"]) ?? "",
    payment_date: getString(payment as Row, ["payment_date"]),
    amount_total: getNumber(payment as Row, ["amount_total"]) ?? 0,
    payment_method: getString(payment as Row, ["payment_method"]) ?? "",
    reference_number: getString(payment as Row, ["reference_number"]) ?? "",
    notes: getString(payment as Row, ["notes"]) ?? "",
  }));

  return NextResponse.json({
    customers: customers ?? [],
    products: products ?? [],
    initialOrder,
    initialPayments: normalizedPayments,
  });
}
