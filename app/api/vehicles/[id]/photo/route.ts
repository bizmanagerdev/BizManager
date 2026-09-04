import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { toHebrewError } from "@/lib/error-messages";
import { withIdempotency } from "@/lib/idempotency";
import { STORAGE_BUCKET } from "@/lib/storage";

const BUCKET = STORAGE_BUCKET;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function safeExtensionFromFilename(name: string) {
  const base = name.split(/[/\\]/).pop() ?? "";
  const parts = base.split(".");
  if (parts.length < 2) return "";
  const ext = (parts.pop() ?? "").toLowerCase();
  return ext.replace(/[^a-z0-9]/g, "").slice(0, 10);
}

/**
 * A vehicle's cover photo — a single slot (`vehicles.photo_document_id`), not a
 * gallery. POST uploads a photo, replacing whatever was there before (the old
 * document + storage object are removed server-side, after the swap lands, so
 * a failed upload never leaves the car photo-less). DELETE just clears it.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
  if (!access.ok) return access.response;
  const { supabase, user, profile } = access.value;

  const { id: tagId } = await context.params;
  if (!tagId) return NextResponse.json({ error: "Missing vehicle id" }, { status: 400 });

  return withIdempotency(req, supabase, user.id, "vehicles/photo", async () => {
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("tag_id,photo_document_id")
      .eq("tag_id", tagId)
      .maybeSingle();
    if (!vehicle) return NextResponse.json({ error: "הרכב לא נמצא." }, { status: 404 });

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File) || file.size <= 0) {
      return NextResponse.json({ error: "לא נבחרה תמונה." }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "הקובץ המצורף חייב להיות תמונה." }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "התמונה גדולה מדי (עד 20MB)." }, { status: 413 });
    }

    const documentId = crypto.randomUUID();
    const displayName = (file.name.split(/[/\\]/).pop() ?? "vehicle-photo").trim() || "vehicle-photo";
    const ext = safeExtensionFromFilename(displayName);
    const storagePath = ext ? `vehicles/${tagId}/${documentId}.${ext}` : `vehicles/${tagId}/${documentId}`;

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (uploadError) return NextResponse.json({ error: toHebrewError(uploadError.message) }, { status: 400 });

    const uploadedAt = new Date().toISOString();
    const { error: docError } = await supabase.from("documents").insert({
      id: documentId,
      document_type: "vehicle_photo",
      business_domain: "general_business",
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

    const { error: vehError } = await supabase
      .from("vehicles")
      .update({ photo_document_id: documentId, updated_at: uploadedAt })
      .eq("tag_id", tagId);
    if (vehError) {
      await supabase.from("documents").delete().eq("id", documentId);
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json({ error: toHebrewError(vehError.message) }, { status: 400 });
    }

    await logAuditEvent({
      supabase,
      tableName: "documents",
      recordId: documentId,
      action: "upload",
      changedBy: profile.id,
      userRole: profile.role,
    });

    // Swap already landed — now best-effort clean up the previous photo, if any.
    const oldDocumentId = vehicle.photo_document_id as string | null;
    if (oldDocumentId && oldDocumentId !== documentId) {
      const { data: oldDoc } = await supabase
        .from("documents")
        .select("storage_key")
        .eq("id", oldDocumentId)
        .maybeSingle();
      await supabase.from("documents").delete().eq("id", oldDocumentId);
      const oldKey = (oldDoc as { storage_key?: string | null } | null)?.storage_key;
      if (oldKey) await supabase.storage.from(BUCKET).remove([oldKey]);
      await logAuditEvent({
        supabase,
        tableName: "documents",
        recordId: oldDocumentId,
        action: "delete",
        changedBy: profile.id,
        userRole: profile.role,
      });
    }

    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60);

    return NextResponse.json({
      photo: {
        documentId,
        url: typeof signed?.signedUrl === "string" ? signed.signedUrl : null,
      },
    });
  });
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;

  const { id: tagId } = await context.params;
  if (!tagId) return NextResponse.json({ error: "Missing vehicle id" }, { status: 400 });

  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("photo_document_id")
    .eq("tag_id", tagId)
    .maybeSingle();
  const documentId = (vehicle as { photo_document_id?: string | null } | null)?.photo_document_id ?? null;
  if (!documentId) return NextResponse.json({ ok: true }); // already gone — idempotent

  const { data: doc } = await supabase.from("documents").select("storage_key").eq("id", documentId).maybeSingle();

  const { error: vehError } = await supabase
    .from("vehicles")
    .update({ photo_document_id: null, updated_at: new Date().toISOString() })
    .eq("tag_id", tagId);
  if (vehError) return NextResponse.json({ error: toHebrewError(vehError.message) }, { status: 400 });

  await supabase.from("documents").delete().eq("id", documentId);
  const storageKey = (doc as { storage_key?: string | null } | null)?.storage_key;
  if (storageKey) await supabase.storage.from(BUCKET).remove([storageKey]);

  await logAuditEvent({
    supabase,
    tableName: "documents",
    recordId: documentId,
    action: "delete",
    changedBy: profile.id,
    userRole: profile.role,
  });

  return NextResponse.json({ ok: true });
}
