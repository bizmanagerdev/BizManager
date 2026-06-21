import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { resolveUserDisplayNamesForValues } from "@/lib/audit";
import { STORAGE_BUCKET } from "@/lib/storage";

type Row = Record<string, unknown>;

function str(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v ? v : null;
}

function inferKind(name: string | null) {
  const ext = (name ?? "").toLowerCase().split(".").pop() ?? "";
  const images = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic"]);
  const videos = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v"]);
  if (images.has(ext)) return "image" as const;
  if (videos.has(ext)) return "video" as const;
  return "file" as const;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { task_id?: string };
    const taskId = typeof body.task_id === "string" ? body.task_id : "";
    if (!taskId) return NextResponse.json({ error: "Missing task_id" }, { status: 400 });

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data: links, error: linksError } = await supabase
      .from("document_links")
      .select("document_id,created_at")
      .eq("entity_type", "task")
      .eq("entity_id", taskId)
      .order("created_at", { ascending: false })
      .range(0, 99);

    if (linksError) return NextResponse.json({ error: toHebrewError(linksError.message) }, { status: 400 });

    const docIds = ((links ?? []) as Row[])
      .map((l) => str(l, "document_id"))
      .filter((v): v is string => Boolean(v));

    if (docIds.length === 0) return NextResponse.json({ attachments: [] });

    const { data: docs } = await supabase
      .from("documents")
      .select("id,file_name,storage_key,uploaded_at,uploaded_by")
      .in("id", docIds);

    const docRows = (docs ?? []) as Row[];
    const uploaderNames = await resolveUserDisplayNamesForValues(
      supabase,
      docRows.map((d) => str(d, "uploaded_by")).filter((v): v is string => Boolean(v))
    );

    const attachments = await Promise.all(
      docRows.map(async (doc) => {
        const key = str(doc, "storage_key") ?? "";
        const name = str(doc, "file_name");
        const uploadedBy = str(doc, "uploaded_by");
        const { data: signed } = key
          ? await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(key, 60 * 60)
          : { data: null };
        return {
          id: str(doc, "id") ?? "",
          kind: inferKind(name),
          original_name: name,
          created_at: str(doc, "uploaded_at"),
          uploader_name: uploadedBy ? uploaderNames[uploadedBy] ?? null : null,
          url: signed?.signedUrl ?? null,
        };
      })
    );

    return NextResponse.json({ attachments });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "Unknown error") }, { status: 500 });
  }
}
