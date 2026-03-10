import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type DeleteProductPayload = {
  id?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as DeleteProductPayload;
    const id = typeof body.id === "string" ? body.id.trim() : "";

    if (!id) {
      return NextResponse.json({ error: "מזהה מוצר חסר." }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: `מחיקת מוצר נכשלה: ${error.message}` }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

