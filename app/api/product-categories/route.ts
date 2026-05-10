import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type CreateCategoryPayload = {
  name?: string;
};

export async function GET() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;

  const { supabase } = access.value;
  const { data, error } = await supabase
    .from("product_categories")
    .select("id,name,active")
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ categories: data ?? [] });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateCategoryPayload;
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!name) {
      return NextResponse.json({ error: "יש להזין שם קטגוריה." }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;

    const { supabase } = access.value;

    const { data: existing, error: existingError } = await supabase
      .from("product_categories")
      .select("id,name,active")
      .eq("name", name)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 400 });
    }

    if (existing) {
      return NextResponse.json({ category: existing });
    }

    const { data, error } = await supabase
      .from("product_categories")
      .insert({ name, active: true })
      .select("id,name,active")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!data) {
      return NextResponse.json({ error: "יצירת קטגוריה נכשלה." }, { status: 400 });
    }

    return NextResponse.json({ category: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
