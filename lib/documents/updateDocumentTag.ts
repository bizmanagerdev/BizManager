import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * RLS on `documents` has no general worker-UPDATE policy (only admin/office
 * ALL, plus a worker's own-insert and order-linked-select) — matches the old
 * /api/documents/tag route's behavior (unrestricted allowedRoles, but a
 * worker's write already silently no-op'd under RLS either way).
 */
export async function updateDocumentTag(documentId: string, documentType: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await createSupabaseBrowserClient()
    .from("documents")
    .update({ document_type: documentType })
    .eq("id", documentId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
