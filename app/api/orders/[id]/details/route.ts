import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type Row = Record<string, unknown>;

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function getNumber(row: Row, key: string) {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sumPayments(rows: Row[]) {
  return rows.reduce((sum, row) => sum + (getNumber(row, "amount_total") ?? 0), 0);
}

function derivePaymentStatus(totalAmount: number, totalPaid: number) {
  if (totalAmount <= 0) return "unpaid";
  if (totalPaid <= 0) return "unpaid";
  if (totalPaid >= totalAmount) return "paid";
  return "partial";
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
    { data: order, error: orderError },
    { data: orderItems, error: itemsError },
    { data: payments, error: paymentsError },
  ] = await Promise.all([
    supabase.from("orders").select("*").eq("id", id).maybeSingle(),
    supabase.from("order_items").select("*").eq("order_id", id).limit(500),
    supabase
      .from("payments")
      .select("id,payment_date,amount_total,payment_method,reference_number,notes,created_at")
      .eq("target_type", "order")
      .eq("target_id", id)
      .order("payment_date", { ascending: false }),
  ]);

  if (orderError) {
    return NextResponse.json({ error: orderError.message }, { status: 400 });
  }
  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 400 });
  }
  if (paymentsError) {
    return NextResponse.json({ error: paymentsError.message }, { status: 400 });
  }
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const customerId = getString(order as Row, "customer_id");
  const { data: customer, error: customerError } = customerId
    ? await supabase
        .from("customers")
        .select("id,name,name_for_invoice,email,phone,address")
        .eq("id", customerId)
        .maybeSingle()
    : { data: null, error: null };

  if (customerError) {
    return NextResponse.json({ error: customerError.message }, { status: 400 });
  }

  const productIds = Array.from(
    new Set(
      (orderItems ?? [])
        .map((row) => (typeof row?.product_id === "string" ? row.product_id : null))
        .filter(Boolean)
    )
  ) as string[];

  const { data: products, error: productsError } =
    productIds.length > 0
      ? await supabase.from("products").select("*").in("id", productIds)
      : { data: [], error: null };

  if (productsError) {
    return NextResponse.json({ error: productsError.message }, { status: 400 });
  }

  const totalAmount = getNumber(order as Row, "total_amount") ?? 0;
  const totalPaid = sumPayments(((payments ?? []) as Row[]) ?? []);

  return NextResponse.json({
    order,
    orderItems: orderItems ?? [],
    payments: payments ?? [],
    customer,
    products: products ?? [],
    totalAmount,
    totalPaid,
    paymentStatus: derivePaymentStatus(totalAmount, totalPaid),
  });
}
