import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

const BUCKET = "business-documents";

export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseRouteClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError) return NextResponse.json({ error: userError.message }, { status: 400 });
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

    const storageKey = typeof (doc as any)?.storage_key === "string" ? (doc as any).storage_key : null;

    const { error: linksError } = await supabase
      .from("document_links")
      .delete()
      .eq("document_id", documentId);
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
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}

