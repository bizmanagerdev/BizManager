import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { id?: string; priority?: string };
    const id = typeof body.id === "string" ? body.id : "";
    const priority = typeof body.priority === "string" ? body.priority : "";

    if (!id || !priority) {
      return NextResponse.json(
        { error: "Missing id or priority" },
        { status: 400 }
      );
    }

    const supabase = await createSupabaseRouteClient();
    const { data, error } = await supabase
      .from("tasks")
      .update({ priority })
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ task: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

