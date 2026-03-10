import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

const BUCKET = "business-documents";

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const body = (await req.json()) as { document_id?: string };
    const documentId = typeof body.document_id === "string" ? body.document_id : "";
    if (!documentId) return NextResponse.json({ error: "Missing document_id" }, { status: 400 });

    const { data: doc, error: readError } = await supabase
      .from("documents")
      .select("id,storage_key")
      .eq("id", documentId)
      .maybeSingle();
    if (readError) return NextResponse.json({ error: readError.message }, { status: 400 });
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const storageKey = typeof doc.storage_key === "string" ? doc.storage_key : null;

    const { error: linksError } = await supabase.from("document_links").delete().eq("document_id", documentId);
    if (linksError) return NextResponse.json({ error: linksError.message }, { status: 400 });

    const { error: docDeleteError } = await supabase.from("documents").delete().eq("id", documentId);
    if (docDeleteError) return NextResponse.json({ error: docDeleteError.message }, { status: 400 });

    if (storageKey) {
      const { error: storageError } = await supabase.storage.from(BUCKET).remove([storageKey]);
      if (storageError) {
        return NextResponse.json(
          { error: storageError.message, warning: "Document row deleted but file removal failed" },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
