import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { STORAGE_BUCKET } from "@/lib/storage";

const BUCKET = STORAGE_BUCKET;

type Row = Record<string, unknown>;

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;
    if (profile.role !== "admin" && profile.role !== "office") {
      return NextResponse.json({ error: "אין הרשאה." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { loan_id?: string };
    const loanId = typeof body.loan_id === "string" ? body.loan_id.trim() : "";
    if (!loanId) return NextResponse.json({ error: "Missing loan_id" }, { status: 400 });

    const { data: links, error: linksError } = await supabase
      .from("document_links")
      .select("document_id")
      .eq("entity_type", "loan")
      .eq("entity_id", loanId);
    if (linksError) return NextResponse.json({ error: toHebrewError(linksError.message) }, { status: 400 });

    const docIds = ((links ?? []) as Row[])
      .map((row) => (typeof row.document_id === "string" ? row.document_id : ""))
      .filter(Boolean);
    if (docIds.length === 0) return NextResponse.json({ documents: [] });

    const { data: docs, error: docsError } = await supabase
      .from("documents")
      .select("id,title,file_name,storage_key,document_type,uploaded_at")
      .in("id", docIds)
      .order("uploaded_at", { ascending: false });
    if (docsError) return NextResponse.json({ error: toHebrewError(docsError.message) }, { status: 400 });

    const documents = await Promise.all(
      ((docs ?? []) as Row[]).map(async (doc) => {
        const storageKey = typeof doc.storage_key === "string" ? doc.storage_key : null;
        const signed = storageKey
          ? await supabase.storage.from(BUCKET).createSignedUrl(storageKey, 60 * 60)
          : null;
        return {
          id: typeof doc.id === "string" ? doc.id : "",
          fileName:
            (typeof doc.file_name === "string" && doc.file_name) ||
            (typeof doc.title === "string" && doc.title) ||
            "מסמך",
          documentType: typeof doc.document_type === "string" ? doc.document_type : null,
          uploadedAt: typeof doc.uploaded_at === "string" ? doc.uploaded_at : null,
          url: signed?.data?.signedUrl ?? null,
        };
      })
    );

    return NextResponse.json({ documents });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "Unknown error") }, { status: 500 });
  }
}
