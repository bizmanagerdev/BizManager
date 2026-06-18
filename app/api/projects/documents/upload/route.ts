import { toHebrewError } from "@/lib/error-messages";
﻿import { NextResponse } from "next/server";
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
    const { supabase, user } = access.value;

    const form = await req.formData();
    const projectId = String(form.get("project_id") ?? "");
    const file = form.get("file");
    const category = String(form.get("category") ?? form.get("tag") ?? "").trim();

    if (!projectId) return NextResponse.json({ error: "Missing project_id" }, { status: 400 });
    if (!file || !(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
    if (file.size <= 0) return NextResponse.json({ error: "Empty file" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: `File too large (max ${MAX_BYTES} bytes)` }, { status: 413 });

    const documentId = crypto.randomUUID();
    const displayName = (file.name.split(/[/\\]/).pop() ?? "file").trim() || "file";
    const ext = safeExtensionFromFilename(displayName);
    const storagePath = ext ? `projects/${projectId}/${documentId}.${ext}` : `projects/${projectId}/${documentId}`;
    const uploadedAt = new Date().toISOString();

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (uploadError) return NextResponse.json({ error: toHebrewError(uploadError.message) }, { status: 400 });

    const { error: docError } = await supabase.from("documents").insert({
      id: documentId,
      document_type: category || "project_document",
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

    const { error: linkError } = await supabase.from("document_links").insert({
      document_id: documentId,
      entity_type: "project",
      entity_id: projectId,
    });

    if (linkError) {
      await supabase.from("documents").delete().eq("id", documentId);
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json({ error: toHebrewError(linkError.message) }, { status: 400 });
    }

    return NextResponse.json({
      document: {
        id: documentId,
        storage_key: storagePath,
        file_name: displayName,
        document_type: category || "project_document",
        uploaded_at: uploadedAt,
      },
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
