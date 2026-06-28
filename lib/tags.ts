import type { SupabaseClient } from "@supabase/supabase-js";

// ════════════════════════════════════════════════════════════════════════════
// Generic tags helpers (server-safe). The cross-cut lives in `entity_tags`.
// See db/sql/create_tags_and_vehicles.sql and lib/vehicles.ts.
//
// Tags are ADDITIVE metadata: syncing them must NEVER block or fail the primary
// write (creating the expense/task/…), so every call is wrapped and swallows
// errors (e.g. before the SQL has been run).
// ════════════════════════════════════════════════════════════════════════════

export type TaggableEntityType = "task" | "expense" | "payment" | "document" | "work_session";

/** Parse a `tag_ids` field off a request body into a clean, de-duped string[]. */
export function parseTagIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(raw.filter((v): v is string => typeof v === "string" && v.length > 0))
  );
}

/**
 * Attach `tagIds` to an entity via entity_tags.
 *   • create flow → pass replace:false (default) — just inserts (idempotent upsert).
 *   • update flow → pass replace:true — clears this entity's links first, then
 *     re-inserts, so unchecking a tag removes it (mirrors the task_members pattern).
 * The underlying expense/task/document is never touched.
 */
export async function syncEntityTags(
  supabase: SupabaseClient,
  entityType: TaggableEntityType,
  entityId: string,
  tagIds: string[],
  opts?: { replace?: boolean; createdBy?: string | null; refYear?: number | null }
): Promise<void> {
  try {
    if (!entityId) return;
    const clean = parseTagIds(tagIds);

    if (opts?.replace) {
      await supabase
        .from("entity_tags")
        .delete()
        .eq("entity_type", entityType)
        .eq("entity_id", entityId);
    }

    if (clean.length === 0) return;

    const rows = clean.map((tag_id) => ({
      tag_id,
      entity_type: entityType,
      entity_id: entityId,
      ref_year: opts?.refYear ?? null,
      created_by: opts?.createdBy ?? null,
    }));

    await supabase
      .from("entity_tags")
      .upsert(rows, { onConflict: "tag_id,entity_type,entity_id", ignoreDuplicates: true });
  } catch {
    // additive metadata — never break the primary write
  }
}

/** Current tag ids attached to an entity (for pre-filling an edit dialog). */
export async function fetchEntityTagIds(
  supabase: SupabaseClient,
  entityType: TaggableEntityType,
  entityId: string
): Promise<string[]> {
  try {
    if (!entityId) return [];
    const { data, error } = await supabase
      .from("entity_tags")
      .select("tag_id")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId);
    if (error) return [];
    return ((data ?? []) as Array<{ tag_id?: string }>)
      .map((r) => r.tag_id)
      .filter((id): id is string => Boolean(id));
  } catch {
    return [];
  }
}
