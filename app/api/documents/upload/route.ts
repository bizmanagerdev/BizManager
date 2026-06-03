import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

import { STORAGE_BUCKET } from "@/lib/storage";

const BUCKET = STORAGE_BUCKET;
const MAX_BYTES = 200 * 1024 * 1024;

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
    const { supabase, user, profile } = access.value;

    const form = await req.formData();
    const file = form.get("file");
    const businessDomain = String(form.get("business_domain") ?? "").trim() || "logistics_projects";
    const projectId = String(form.get("project_id") ?? "").trim();
    const propertyId = String(form.get("property_id") ?? "").trim();
    const category = String(form.get("category") ?? form.get("tag") ?? "").trim();

    if (businessDomain === "logistics_projects" && !projectId) {
      return NextResponse.json({ error: "Missing project_id" }, { status: 400 });
    }
    if (businessDomain === "property_management" && !propertyId) {
      return NextResponse.json({ error: "Missing property_id" }, { status: 400 });
    }
    if (!["logistics_projects", "property_management"].includes(businessDomain)) {
      return NextResponse.json({ error: "Unsupported business_domain" }, { status: 400 });
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

    const documentId = crypto.randomUUID();
    const displayName = (file.name.split(/[/\\]/).pop() ?? "file").trim() || "file";
    const ext = safeExtensionFromFilename(displayName);
    const linkedEntityType = businessDomain === "property_management" ? "property" : "project";
    const linkedEntityId = businessDomain === "property_management" ? propertyId : projectId;
    const storageFolder = businessDomain === "property_management" ? "properties" : "projects";
    const storagePath = ext
      ? `${storageFolder}/${linkedEntityId}/${documentId}.${ext}`
      : `${storageFolder}/${linkedEntityId}/${documentId}`;
    const uploadedAt = new Date().toISOString();

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 400 });
    }

    const { error: docError } = await supabase.from("documents").insert({
      id: documentId,
      document_type: category || "general_document",
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

    const { error: linkError } = await supabase.from("document_links").insert({
      document_id: documentId,
      entity_type: linkedEntityType,
      entity_id: linkedEntityId,
    });

    if (linkError) {
      await supabase.from("documents").delete().eq("id", documentId);
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json({ error: linkError.message }, { status: 400 });
    }

    await logAuditEvent({
      supabase,
      tableName: "documents",
      recordId: documentId,
      action: "upload",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({
      document: {
        id: documentId,
        storage_key: storagePath,
        file_name: displayName,
        document_type: category || "general_document",
        uploaded_at: uploadedAt,
        business_domain: businessDomain,
        project_id: projectId || null,
        property_id: propertyId || null,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
