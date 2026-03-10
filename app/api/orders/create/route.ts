import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type CreateOrderItemPayload = {
  product_id?: string;
  quantity_ordered?: number | string;
  unit_price?: number | string;
  discount_amount?: number | string;
  notes?: string | null;
};

type CreateOrderPayload = {
  customer_id?: string;
  order_date?: string;
  status?: string;
  payment_status?: string;
  discount_amount?: number | string;
  notes?: string | null;
  items?: CreateOrderItemPayload[];
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
    const body = (await req.json()) as CreateOrderPayload;

    const customerId = typeof body.customer_id === "string" ? body.customer_id : "";
    const orderDate = typeof body.order_date === "string" ? body.order_date : "";
    const status = typeof body.status === "string" ? body.status : "draft";
    const paymentStatus = typeof body.payment_status === "string" ? body.payment_status : "unpaid";
    const discountAmount = toNumber(body.discount_amount ?? 0);
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;

    const items = Array.isArray(body.items) ? body.items : [];
    if (!customerId || !orderDate || items.length === 0) {
      return NextResponse.json({ error: "Missing required order fields" }, { status: 400 });
    }
    if (!Number.isFinite(discountAmount) || discountAmount < 0) {
      return NextResponse.json({ error: "Invalid discount amount" }, { status: 400 });
    }

    const normalizedItems = items.map((item) => ({
      product_id: typeof item.product_id === "string" ? item.product_id : "",
      quantity_ordered: toNumber(item.quantity_ordered),
      unit_price: toNumber(item.unit_price),
      discount_amount: toNumber(item.discount_amount ?? 0),
      notes: typeof item.notes === "string" ? item.notes.trim() : null,
    }));

    const invalidItem = normalizedItems.find(
      (item) =>
        !item.product_id ||
        !Number.isFinite(item.quantity_ordered) ||
        item.quantity_ordered <= 0 ||
        !Number.isFinite(item.unit_price) ||
        item.unit_price < 0 ||
        !Number.isFinite(item.discount_amount) ||
        item.discount_amount < 0
    );
    if (invalidItem) {
      return NextResponse.json({ error: "Invalid order item payload" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    const subtotal = normalizedItems.reduce(
      (sum, item) => sum + item.quantity_ordered * item.unit_price - item.discount_amount,
      0
    );
    const totalAmount = subtotal - discountAmount;

    const { data, error } = await supabase.rpc("create_sales_order", {
      p_customer_id: customerId,
      p_order_date: orderDate,
      p_status: status,
      p_subtotal: subtotal,
      p_discount_amount: discountAmount,
      p_total_amount: totalAmount,
      p_payment_status: paymentStatus,
      p_created_by: user.id,
      p_notes: notes,
      p_items: normalizedItems,
    });

    if (error) {
      const hint =
        error.message.includes("create_sales_order") || error.message.includes("function")
          ? "Missing DB function create_sales_order. Run db/sql/create_sales_order_rpc.sql"
          : error.message;
      return NextResponse.json({ error: hint }, { status: 400 });
    }

    const orderId = typeof data === "string" ? data : null;
    if (!orderId) return NextResponse.json({ error: "Failed to create order" }, { status: 500 });

    return NextResponse.json({ order_id: orderId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
