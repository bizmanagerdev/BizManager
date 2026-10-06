import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// When a save fails halfway — the document (or expense) row is in, the step
// after it isn't — the route takes the row back out. Workers may not delete
// those rows themselves (no delete rule for them), so with only their session
// the delete silently did nothing and a half-made row was left behind. This
// tries the person's own session first, then removes exactly that row with the
// server's own access — only that id, and only if this person created it.

async function deleteJustCreated(
  supabase: SupabaseClient,
  table: "documents" | "expenses",
  id: string,
  creatorColumn: "uploaded_by" | "recorded_by",
  creatorId: string
): Promise<void> {
  const own = await supabase.from(table).delete().eq("id", id).select("id");
  if (!own.error && (own.data?.length ?? 0) > 0) return;
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  await admin.from(table).delete().eq("id", id).eq(creatorColumn, creatorId);
}

/** Take back a document row this request just inserted (`uploaded_by` = the person). */
export function undoDocumentCreate(supabase: SupabaseClient, documentId: string, uploaderId: string): Promise<void> {
  return deleteJustCreated(supabase, "documents", documentId, "uploaded_by", uploaderId);
}

/** Take back an expense row this request just inserted (`recorded_by` = the person). */
export function undoExpenseCreate(supabase: SupabaseClient, expenseId: string, recorderId: string): Promise<void> {
  return deleteJustCreated(supabase, "expenses", expenseId, "recorded_by", recorderId);
}
