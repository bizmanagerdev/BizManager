import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * RLS on `documents` has no general worker-UPDATE policy (only admin/office
 * ALL, plus a worker's own-insert and order-linked-select) — matches the old
 * /api/documents/tag route's behavior (unrestricted allowedRoles, but a
 * worker's write already silently no-op'd under RLS either way).
 */
export async function updateDocumentTag(
  documentId: string,
  documentType: string,
  /** ISO date, "" to clear, or undefined to leave the expiry untouched. Only
   *  categories whose registry row has tracks_expiry ever send it. */
  validUntil?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createSupabaseBrowserClient();
  const patch: Record<string, unknown> = { document_type: documentType };
  if (validUntil !== undefined) patch.valid_until = validUntil.trim() || null;

  const { error } = await supabase.from("documents").update(patch).eq("id", documentId);
  if (!error) return { ok: true };

  // The expiry column arrives with 20260922183535. Pre-migration, still save
  // the category rather than failing the whole edit.
  const missingColumn =
    error.code === "42703" || (error.message ?? "").includes("valid_until");
  if (missingColumn && validUntil !== undefined) {
    const retry = await supabase
      .from("documents")
      .update({ document_type: documentType })
      .eq("id", documentId);
    if (!retry.error) return { ok: true };
    return { ok: false, error: retry.error.message };
  }
  return { ok: false, error: error.message };
}
