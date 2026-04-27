import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      project_id?: string;
      agreed_base_price?: number | string | null;
    };

    const projectId = typeof body.project_id === "string" ? body.project_id : "";
    const agreedBasePrice =
      body.agreed_base_price === null
        ? null
        : typeof body.agreed_base_price === "number"
          ? body.agreed_base_price
          : typeof body.agreed_base_price === "string"
            ? Number(body.agreed_base_price)
            : NaN;

    if (!projectId) return NextResponse.json({ error: "Missing project_id" }, { status: 400 });
    if (agreedBasePrice !== null && !Number.isFinite(agreedBasePrice)) {
      return NextResponse.json({ error: "Invalid agreed_base_price" }, { status: 400 });
    }
    if (typeof agreedBasePrice === "number" && agreedBasePrice < 0) {
      return NextResponse.json({ error: "agreed_base_price must be >= 0" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const nextBasePrice = agreedBasePrice ?? 0;

    const { data, error } = await supabase
      .from("projects")
      .update({
        agreed_base_price: nextBasePrice,
        actual_price: nextBasePrice,
      })
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
