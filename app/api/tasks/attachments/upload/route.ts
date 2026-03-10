import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

const BUCKET = "business-documents";
const MAX_BYTES = 200 * 1024 * 1024;

function safeExtensionFromFilename(name: string) {
  const base = name.split(/[/\\]/).pop() ?? "";
  const parts = base.split(".");
  if (parts.length < 2) return "";
  const ext = (parts.pop() ?? "").toLowerCase();
  return ext.replace(/[^a-z0-9]/g, "").slice(0, 10);
}

function kindFromMime(mimeType: string | null) {
  const t = (mimeType ?? "").toLowerCase();
  if (t.startsWith("image/")) return "image" as const;
  if (t.startsWith("video/")) return "video" as const;
  return "file" as const;
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    const form = await req.formData();
    const taskId = String(form.get("task_id") ?? "");
    const file = form.get("file");

    if (!taskId) return NextResponse.json({ error: "Missing task_id" }, { status: 400 });
    if (!file || !(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
    if (file.size <= 0) return NextResponse.json({ error: "Empty file" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: `File too large (max ${MAX_BYTES} bytes)` }, { status: 413 });

    const documentId = crypto.randomUUID();
    const displayName = (file.name.split(/[/\\]/).pop() ?? "file").trim() || "file";
    const ext = safeExtensionFromFilename(displayName);
    const storagePath = ext ? `tasks/${taskId}/${documentId}.${ext}` : `tasks/${taskId}/${documentId}`;
    const kind = kindFromMime(file.type || null);

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 400 });

    const uploadedAt = new Date().toISOString();

    const { error: docError } = await supabase.from("documents").insert({
      id: documentId,
      document_type: "task_attachment",
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
      entity_type: "task",
      entity_id: taskId,
    });

    if (linkError) {
      await supabase.from("documents").delete().eq("id", documentId);
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json({ error: linkError.message }, { status: 400 });
    }

    try {
      const { data: taskRow } = await supabase.from("tasks").select("id,project_id").eq("id", taskId).maybeSingle();
      const projectId = typeof taskRow?.project_id === "string" ? taskRow.project_id : null;
      if (projectId) {
        const { data: existingLink } = await supabase
          .from("document_links")
          .select("id")
          .eq("document_id", documentId)
          .eq("entity_type", "project")
          .eq("entity_id", projectId)
          .maybeSingle();
        if (!existingLink) {
          await supabase.from("document_links").insert({
            document_id: documentId,
            entity_type: "project",
            entity_id: projectId,
          });
        }
      }
    } catch {
      // Non-fatal.
    }

    return NextResponse.json({
      attachment: {
        id: documentId,
        task_id: taskId,
        bucket: BUCKET,
        storage_key: storagePath,
        kind,
        file_name: displayName,
        uploaded_at: uploadedAt,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
