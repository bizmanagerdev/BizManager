import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

import { STORAGE_BUCKET } from "@/lib/storage";

const BUCKET = STORAGE_BUCKET;
const MAX_BYTES = 20 * 1024 * 1024;

function safeExtensionFromFilename(name: string) {
  const base = name.split(/[/\\]/).pop() ?? "";
  const parts = base.split(".");
  if (parts.length < 2) return "";
  return (parts.pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
}

// Stores a statement file (Excel/CSV/PDF) and a documents row, returning the
// document id so the import can attach it to the persisted statement. Mirrors
// app/api/financial-attachments/upload but without an entity link (the statement is
// created afterwards by the import route).
//
// Serves both importers — the credit-card one (default) and the bank עובר ושב
// one — which differ only in the documents row's type. Pass type=bank_statement
// for the latter so the documents screen can tell them apart.
export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (file.size <= 0) return NextResponse.json({ error: "Empty file" }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File too large (max ${MAX_BYTES} bytes)` }, { status: 413 });
    }

    const documentId = crypto.randomUUID();
    const displayName = (file.name.split(/[/\\]/).pop() ?? "statement").trim() || "statement";
    const ext = safeExtensionFromFilename(displayName);
    const storagePath = ext ? `statements/${documentId}.${ext}` : `statements/${documentId}`;
    const uploadedAt = new Date().toISOString();

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (uploadError) return NextResponse.json({ error: toHebrewError(uploadError.message) }, { status: 400 });

    const requestedType = form.get("type");
    const documentType =
      typeof requestedType === "string" && requestedType.trim() === "bank_statement"
        ? "bank_statement"
        : "card_statement";

    const { error: docError } = await supabase.from("documents").insert({
      id: documentId,
      document_type: documentType,
      title: displayName,
      file_name: displayName,
      storage_key: storagePath,
      uploaded_by: user.id,
      uploaded_at: uploadedAt,
      notes: null,
    });
    if (docError) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json({ error: toHebrewError(docError.message) }, { status: 400 });
    }

    return NextResponse.json({ document_id: documentId, storage_key: storagePath });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
