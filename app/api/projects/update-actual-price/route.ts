import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { project_id?: string; actual_price?: number | string | null };

    const projectId = typeof body.project_id === "string" ? body.project_id : "";
    const actualPrice =
      body.actual_price === null
        ? null
        : typeof body.actual_price === "number"
          ? body.actual_price
          : typeof body.actual_price === "string"
            ? Number(body.actual_price)
            : NaN;

    if (!projectId) return NextResponse.json({ error: "Missing project_id" }, { status: 400 });
    if (actualPrice !== null && !Number.isFinite(actualPrice)) {
      return NextResponse.json({ error: "Invalid actual_price" }, { status: 400 });
    }
    if (typeof actualPrice === "number" && actualPrice <= 0) {
      return NextResponse.json({ error: "actual_price must be > 0" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data, error } = await supabase
      .from("projects")
      .update({ actual_price: actualPrice })
      .eq("id", projectId)
      .select("id,agreed_base_price,actual_price,updated_at")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ project: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
