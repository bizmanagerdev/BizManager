import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Result = { ok: true } | { ok: false; error: string };

/**
 * RLS ("Staff manage card statements"/"Staff manage card statement rows",
 * admin/office) matches all 3 old routes' admin/office allowedRoles gate
 * exactly.
 */
export async function deleteCardStatement(statementId: string): Promise<Result> {
  const supabase = createSupabaseBrowserClient();
  const rowsResult = await supabase.from("card_statement_rows").delete().eq("statement_id", statementId);
  if (rowsResult.error) return { ok: false, error: rowsResult.error.message };
  const stmtResult = await supabase.from("card_statements").delete().eq("id", statementId);
  if (stmtResult.error) return { ok: false, error: stmtResult.error.message };
  return { ok: true };
}

export async function markCardStatementDone(statementId: string, done: boolean): Promise<Result> {
  const { error } = await createSupabaseBrowserClient()
    .from("card_statements")
    .update({ marked_done: done })
    .eq("id", statementId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function reassignCardStatementRows(rowIds: string[], cardLabel: string): Promise<Result> {
  const { error } = await createSupabaseBrowserClient()
    .from("card_statement_rows")
    .update({ card_label: cardLabel })
    .in("id", rowIds);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
