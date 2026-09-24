import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// ────────────────────────────────────────────────────────────────────────────
// Filing an unfiled document.
//
// The archive could show you a backlog of unattached files and could not do
// anything about it — the triage banner narrowed to them and then left you
// there. This is the action that resolves one.
//
// ⚠️ Vehicles are not stored like the others. A vehicle IS a tag, and its
// documents hang off `entity_tags` (see lib/vehicles.ts); everything else uses
// `document_links`. Writing a vehicle into document_links would "work" and then
// be invisible to the vehicle page, the רכבים facet and the grouping — all
// three read tags. Hence the branch.
// ────────────────────────────────────────────────────────────────────────────

export const ASSIGNABLE_ENTITY_TYPES = [
  "project",
  "order",
  "customer",
  "property",
  "vehicle",
  "task",
] as const;
export type AssignableEntityType = (typeof ASSIGNABLE_ENTITY_TYPES)[number];

export const ASSIGNABLE_ENTITY_LABEL: Record<AssignableEntityType, string> = {
  project: "פרויקט",
  order: "הזמנה",
  customer: "לקוח",
  property: "נכס",
  vehicle: "רכב",
  task: "משימה",
};

export async function assignDocumentToEntity(
  documentId: string,
  entityType: AssignableEntityType,
  entityId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createSupabaseBrowserClient();
  if (!documentId || !entityId) return { ok: false, error: "missing target" };

  if (entityType === "vehicle") {
    // entityId is the vehicle's tag_id — its canonical identity everywhere.
    const existing = await supabase
      .from("entity_tags")
      .select("id")
      .eq("tag_id", entityId)
      .eq("entity_type", "document")
      .eq("entity_id", documentId)
      .limit(1);
    if (!existing.error && (existing.data ?? []).length > 0) return { ok: true };

    const { error } = await supabase
      .from("entity_tags")
      .insert({ tag_id: entityId, entity_type: "document", entity_id: documentId });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  // document_links has no unique constraint, so dedupe before inserting rather
  // than creating a second identical row.
  const existing = await supabase
    .from("document_links")
    .select("id")
    .eq("document_id", documentId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .limit(1);
  if (!existing.error && (existing.data ?? []).length > 0) return { ok: true };

  const { error } = await supabase
    .from("document_links")
    .insert({ document_id: documentId, entity_type: entityType, entity_id: entityId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * File several documents against the same target. Sequential rather than
 * parallel: each call may do a dedupe SELECT then an INSERT, and a burst of
 * those from the browser is a good way to hit rate limits for no gain on a
 * handful of rows.
 */
export async function assignDocumentsToEntity(
  documentIds: string[],
  entityType: AssignableEntityType,
  entityId: string
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const documentId of documentIds) {
    const result = await assignDocumentToEntity(documentId, entityType, entityId);
    if (result.ok) ok += 1;
    else failed += 1;
  }
  return { ok, failed };
}
