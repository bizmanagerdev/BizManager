import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  fetchDocumentCategories,
  requiredCategoriesFor,
  type ChecklistEntityType,
} from "@/lib/documents/categories";

// ────────────────────────────────────────────────────────────────────────────
// "מסמכים חסרים" — which documents an entity is expected to hold, and whether
// it actually holds them.
//
// The expectation is data, not code: a category's registry row lists the entity
// types it is required for, so an admin ticking "נדרש עבור: רכב" on ביטוח makes
// every vehicle start reporting a missing insurance certificate.
//
// ⚠️ THE TWO RESOLUTION PATHS ARE NOT INTERCHANGEABLE. A vehicle's documents
// hang off `entity_tags` (a vehicle IS a tag — see lib/vehicles.ts), while every
// other entity uses `document_links`. Querying the wrong one silently reports
// every document as missing.
// ────────────────────────────────────────────────────────────────────────────

export type ChecklistItem = {
  code: string;
  label: string;
  present: boolean;
  /** The newest matching document, when there is one — lets the UI link to it. */
  documentId: string | null;
  validUntil: string | null;
};

/** Resolve the ids of the documents attached to one entity. */
async function attachedDocumentIds(
  supabase: SupabaseClient,
  entityType: ChecklistEntityType,
  entityId: string
): Promise<string[]> {
  if (entityType === "vehicle") {
    // entityId is the vehicle's tag_id, which is its canonical identity.
    const { data, error } = await supabase
      .from("entity_tags")
      .select("entity_id")
      .eq("tag_id", entityId)
      .eq("entity_type", "document");
    const tagged = error
      ? []
      : (data ?? [])
          .map((row) => (typeof row.entity_id === "string" ? row.entity_id : null))
          .filter((v): v is string => Boolean(v));

    // ⚠️ A vehicle's cover photo is NOT tagged — it hangs off
    // `vehicles.photo_document_id` as a plain foreign key (see
    // lib/documents/owners.ts, which exists because this keeps happening).
    // Without it the checklist reports "צילום חסר" for a car that is showing
    // its photograph at the top of the very same page.
    const { data: vehicleRow } = await supabase
      .from("vehicles")
      .select("photo_document_id")
      .eq("tag_id", entityId)
      .maybeSingle();
    const cover = (vehicleRow as { photo_document_id?: string | null } | null)?.photo_document_id;
    return cover ? Array.from(new Set([...tagged, cover])) : tagged;
  }

  const { data, error } = await supabase
    .from("document_links")
    .select("document_id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId);
  if (error) return [];
  return (data ?? [])
    .map((row) => (typeof row.document_id === "string" ? row.document_id : null))
    .filter((v): v is string => Boolean(v));
}

/**
 * Does this document count as the category?
 *
 * Usually the stored type IS the category code. The exception is photographs:
 * the upload routes write their own source codes (`vehicle_photo`,
 * `project_photo`, `order_delivery_image`) and never the word צילום, so a
 * literal comparison declares a car with a photo to be missing its photo.
 */
function satisfiesCategory(
  documentType: unknown,
  category: { code: string; is_photo: boolean }
): boolean {
  const type = typeof documentType === "string" ? documentType.trim() : "";
  if (!type) return false;
  if (type === category.code) return true;
  return category.is_photo && /photo|image|צילום/i.test(type);
}

/**
 * The checklist for one entity. Returns `[]` when nothing is required of this
 * entity type (the default — requirements are opt-in per category) or when the
 * registry table does not exist yet, so the UI simply renders nothing.
 */
export async function getChecklistForEntity(
  supabase: SupabaseClient,
  entityType: ChecklistEntityType,
  entityId: string
): Promise<ChecklistItem[]> {
  if (!entityId) return [];

  const categories = await fetchDocumentCategories(supabase);
  const required = requiredCategoriesFor(categories, entityType);
  if (required.length === 0) return [];

  const documentIds = await attachedDocumentIds(supabase, entityType, entityId);
  if (documentIds.length === 0) {
    return required.map((c) => ({
      code: c.code,
      label: c.label,
      present: false,
      documentId: null,
      validUntil: null,
    }));
  }

  // `valid_until` only exists after 20260922183535; fall back so a database one
  // migration behind still reports presence correctly, just without the date.
  let rows: Record<string, unknown>[] = [];
  const full = await supabase
    .from("documents")
    .select("id,document_type,valid_until,uploaded_at")
    .in("id", documentIds);
  if (full.error) {
    const base = await supabase
      .from("documents")
      .select("id,document_type,uploaded_at")
      .in("id", documentIds);
    if (base.error) return [];
    rows = (base.data ?? []) as Record<string, unknown>[];
  } else {
    rows = (full.data ?? []) as Record<string, unknown>[];
  }

  // Newest first, so the document we surface for a category is the current one.
  rows.sort((a, b) => String(b.uploaded_at ?? "").localeCompare(String(a.uploaded_at ?? "")));

  return required.map((category) => {
    const match = rows.find((row) => satisfiesCategory(row.document_type, category));
    return {
      code: category.code,
      label: category.label,
      present: Boolean(match),
      documentId: typeof match?.id === "string" ? match.id : null,
      validUntil: typeof match?.valid_until === "string" ? match.valid_until : null,
    };
  });
}

/** Browser-side convenience — same contract, creates its own client. */
export function fetchChecklistForEntity(entityType: ChecklistEntityType, entityId: string) {
  return getChecklistForEntity(createSupabaseBrowserClient(), entityType, entityId);
}
