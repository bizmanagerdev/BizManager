import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { id?: string };
    const id = typeof body.id === "string" ? body.id : "";

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id,business_domain,project_id,property_id,assigned_user_id,subject,description,due_date,priority,status,created_at,updated_at,notes"
      )
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ task: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

