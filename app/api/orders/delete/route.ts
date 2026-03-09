import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { order_id?: string };
    const orderId = typeof body.order_id === "string" ? body.order_id : "";

    if (!orderId) {
      return NextResponse.json({ error: "חסר מזהה הזמנה." }, { status: 400 });
    }

    const supabase = await createSupabaseRouteClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      return NextResponse.json({ error: `שגיאת אימות משתמש: ${userError.message}` }, { status: 400 });
    }
    if (!user) {
      return NextResponse.json({ error: "אין הרשאה לבצע פעולה זו." }, { status: 401 });
    }

    const { data, error } = await supabase.rpc("delete_sales_order", {
      p_order_id: orderId,
      p_deleted_by: user.id,
    });

    if (error) {
      const hint =
        error.message.includes("delete_sales_order") || error.message.includes("function")
          ? "פונקציית מחיקה חסרה. יש להריץ db/sql/delete_sales_order_rpc.sql ב-Supabase SQL Editor."
          : error.message;
      return NextResponse.json({ error: hint }, { status: 400 });
    }

    if (data !== true) {
      return NextResponse.json({ error: "מחיקת הזמנה נכשלה." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
