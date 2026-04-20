import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type Row = Record<string, unknown>;

function getString(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value : null;
}

function getNumber(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
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
    { data: order, error: orderError },
    { data: orderItems, error: itemsError },
    { data: payments, error: paymentsError },
    { data: financials, error: financialsError },
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("id,customer_id,order_date,status,payment_status,discount_amount,notes")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("order_items")
      .select("id,order_id,product_id,quantity_ordered,unit_price,discount_amount,line_total,notes")
      .eq("order_id", id),
    supabase
      .from("payments")
      .select("id,payment_date,amount_total,payment_method,reference_number,notes,created_at")
      .eq("order_id", id)
      .order("payment_date", { ascending: false }),
    supabase
      .from("order_financials_view")
      .select("id,total_amount,total_paid,remaining_balance,payment_count,payment_status")
      .eq("id", id)
      .maybeSingle(),
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
  if (financialsError) {
    const missingView = financialsError.message.includes("order_financials_view");
    if (!missingView) {
      return NextResponse.json({ error: financialsError.message }, { status: 400 });
    }
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
      ? await supabase.from("products").select("id,name,sku,barcode").in("id", productIds)
      : { data: [], error: null };

  if (productsError) {
    return NextResponse.json({ error: productsError.message }, { status: 400 });
  }

  const financialRow = (financials as Row | null) ?? null;
  const totalAmount = getNumber(financialRow, "total_amount") ?? 0;
  const totalPaid = getNumber(financialRow, "total_paid") ?? 0;
  const paymentStatus = getString(financialRow, "payment_status") ?? "unpaid";
  const paymentCount = getNumber(financialRow, "payment_count") ?? (payments ?? []).length;
  const remainingBalance = getNumber(financialRow, "remaining_balance") ?? 0;

  return NextResponse.json({
    order,
    orderItems: orderItems ?? [],
    payments: payments ?? [],
    customer,
    products: products ?? [],
    totalAmount,
    totalPaid,
    remainingBalance,
    paymentCount,
    paymentStatus,
  });
}
