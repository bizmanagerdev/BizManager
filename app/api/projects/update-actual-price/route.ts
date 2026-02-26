import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      project_id?: string;
      actual_price?: number | string | null;
    };

    const projectId = typeof body.project_id === "string" ? body.project_id : "";

    const actualPrice =
      body.actual_price === null
        ? null
        : typeof body.actual_price === "number"
          ? body.actual_price
          : typeof body.actual_price === "string"
            ? Number(body.actual_price)
            : NaN;

    if (!projectId) {
      return NextResponse.json({ error: "Missing project_id" }, { status: 400 });
    }

    if (actualPrice !== null && !Number.isFinite(actualPrice)) {
      return NextResponse.json(
        { error: "Invalid actual_price" },
        { status: 400 }
      );
    }

    if (typeof actualPrice === "number" && actualPrice <= 0) {
      return NextResponse.json(
        { error: "actual_price must be > 0" },
        { status: 400 }
      );
    }

    const supabase = await createSupabaseRouteClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 400 });
    }
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("projects")
      .update({ actual_price: actualPrice })
      .eq("id", projectId)
      .select("id,agreed_base_price,actual_price,updated_at")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ project: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

