import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { order_id?: string };
    const orderId = typeof body.order_id === "string" ? body.order_id : "";

    if (!orderId) {
      return NextResponse.json({ error: "Missing order_id" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    const { data, error } = await supabase.rpc("delete_sales_order", {
      p_order_id: orderId,
      p_deleted_by: user.id,
    });

    if (error) {
      const hint =
        error.message.includes("delete_sales_order") || error.message.includes("function")
          ? "Missing DB function delete_sales_order. Run db/sql/delete_sales_order_rpc.sql"
          : error.message;
      return NextResponse.json({ error: hint }, { status: 400 });
    }

    if (data !== true) return NextResponse.json({ error: "Delete failed" }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
