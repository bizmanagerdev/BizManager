import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const body = (await req.json()) as { document_id?: string; document_type?: string };
    const documentId = typeof body.document_id === "string" ? body.document_id : "";
    const documentType = typeof body.document_type === "string" ? body.document_type.trim() : "";

    if (!documentId) return NextResponse.json({ error: "Missing document_id" }, { status: 400 });
    if (!documentType) return NextResponse.json({ error: "Missing document_type" }, { status: 400 });

    const { error } = await supabase.from("documents").update({ document_type: documentType }).eq("id", documentId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
