import type { SupabaseClient } from "@supabase/supabase-js";

// ────────────────────────────────────────────────────────────────────────────
// One insert path for public.documents, tolerant of a database that is one
// migration behind.
//
// WHY THIS EXISTS
// Phase 2 of the category rework added `source`, `valid_until`, `doc_date` and
// `amount` to documents. Every upload route now sets at least `source`. If the
// code ships before 20260922183535_documents_source_and_dates.sql runs, a bare
// insert fails with Postgres 42703 ("column does not exist") and EVERY upload
// in the app breaks — orders, tasks, expenses, vehicles, the archive, all of
// it. That is a deploy-ordering trap, not a bug anyone would notice in review.
//
// So: try the full row, and if the database does not know the new columns yet,
// retry once with them stripped. The document still lands; it just arrives
// without its source until the migration runs. Mirrors the tolerance
// lib/customers/workerLink.ts applies to `linked_user_id`.
// ────────────────────────────────────────────────────────────────────────────

export type DocumentInsertError = { code?: string; message?: string } | null;

/** Columns added by the Phase 2 migration; the only ones worth retrying without. */
const PHASE2_COLUMNS = ["source", "valid_until", "doc_date", "amount"] as const;

export function isMissingDocumentColumn(error: DocumentInsertError | undefined): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  const message = typeof error.message === "string" ? error.message : "";
  return PHASE2_COLUMNS.some((column) => message.includes(column));
}

export type DocumentInsertRow = Record<string, unknown>;

/**
 * Insert one or more document rows. Returns `{ error }` with the same shape the
 * call sites already branch on, so each route keeps its own storage-rollback
 * handling unchanged.
 */
export async function insertDocumentRow(
  supabase: SupabaseClient,
  row: DocumentInsertRow | DocumentInsertRow[]
): Promise<{ error: DocumentInsertError }> {
  const { error } = await supabase.from("documents").insert(row as never);
  if (!error) return { error: null };
  if (!isMissingDocumentColumn(error)) return { error };

  const strip = (r: DocumentInsertRow) => {
    const copy = { ...r };
    for (const column of PHASE2_COLUMNS) delete copy[column];
    return copy;
  };
  const legacy = Array.isArray(row) ? row.map(strip) : strip(row);
  const retry = await supabase.from("documents").insert(legacy as never);
  return { error: retry.error ?? null };
}
