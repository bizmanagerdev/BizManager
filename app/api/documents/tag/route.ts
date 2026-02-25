import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseRouteClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError) return NextResponse.json({ error: userError.message }, { status: 400 });
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as { document_id?: string; document_type?: string };
    const documentId = typeof body.document_id === "string" ? body.document_id : "";
    const documentType =
      typeof body.document_type === "string" ? body.document_type.trim() : "";

    if (!documentId) return NextResponse.json({ error: "Missing document_id" }, { status: 400 });
    if (!documentType) return NextResponse.json({ error: "Missing document_type" }, { status: 400 });

    const { error } = await supabase
      .from("documents")
      .update({ document_type: documentType })
      .eq("id", documentId);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}

