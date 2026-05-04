import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

const BUCKET = "business-documents";
const MAX_BYTES = 20 * 1024 * 1024;

function safeExtensionFromFilename(name: string) {
  const base = name.split(/[/\\]/).pop() ?? "";
  const parts = base.split(".");
  if (parts.length < 2) return "";
  const ext = (parts.pop() ?? "").toLowerCase();
  return ext.replace(/[^a-z0-9]/g, "").slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    const form = await req.formData();
    const entityTypeValue = String(form.get("entity_type") ?? "").trim();
    const entityId = String(form.get("entity_id") ?? "").trim();
    const file = form.get("file");

    const entityType =
      entityTypeValue === "expense" || entityTypeValue === "payment" || entityTypeValue === "session"
        ? entityTypeValue
        : null;

    if (!entityType) {
      return NextResponse.json({ error: "Missing or invalid entity_type" }, { status: 400 });
    }
    if (!entityId) {
      return NextResponse.json({ error: "Missing entity_id" }, { status: 400 });
    }
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File too large (max ${MAX_BYTES} bytes)` }, { status: 413 });
    }

    const table =
      entityType === "expense"
        ? "expenses"
        : entityType === "payment"
          ? "payments"
          : "attendance_sessions";
    const { data: entity, error: entityError } = await supabase
      .from(table)
      .select("id,project_id")
      .eq("id", entityId)
      .maybeSingle();

    if (entityError) return NextResponse.json({ error: entityError.message }, { status: 400 });
    if (!entity?.id) return NextResponse.json({ error: `${entityType} not found` }, { status: 404 });

    const documentId = crypto.randomUUID();
    const displayName = (file.name.split(/[/\\]/).pop() ?? "attachment").trim() || "attachment";
    const ext = safeExtensionFromFilename(displayName);
    const storagePath = ext
      ? `financial/${entityType}s/${entityId}/${documentId}.${ext}`
      : `financial/${entityType}s/${entityId}/${documentId}`;
    const uploadedAt = new Date().toISOString();

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 400 });

    const { error: docError } = await supabase.from("documents").insert({
      id: documentId,
      document_type: `${entityType}_attachment`,
      title: displayName,
      file_name: displayName,
      storage_key: storagePath,
      uploaded_by: user.id,
      uploaded_at: uploadedAt,
      notes: null,
    });

    if (docError) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json({ error: docError.message }, { status: 400 });
    }

    const linkRows = [
      {
        document_id: documentId,
        entity_type: entityType,
        entity_id: entityId,
      },
    ];

    if (typeof entity.project_id === "string" && entity.project_id) {
      linkRows.push({
        document_id: documentId,
        entity_type: "project",
        entity_id: entity.project_id,
      });
    }

    const { error: linkError } = await supabase.from("document_links").insert(linkRows);

    if (linkError) {
      await supabase.from("documents").delete().eq("id", documentId);
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json({ error: linkError.message }, { status: 400 });
    }

    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60);

    return NextResponse.json({
      attachment: {
        document_id: documentId,
        file_name: displayName,
        storage_key: storagePath,
        document_type: `${entityType}_attachment`,
        uploaded_at: uploadedAt,
        url: typeof signed?.signedUrl === "string" ? signed.signedUrl : null,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
