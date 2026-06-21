import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Deletes a card_statements record and all its card_statement_rows.
// Expenses that were already created from this statement are NOT deleted —
// they are independent records in the expenses table.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { statement_id?: string };
    const statementId = typeof body.statement_id === "string" ? body.statement_id.trim() : "";
    if (!statementId) {
      return NextResponse.json({ error: "חסר מזהה פירוט." }, { status: 400 });
    }

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    // Rows reference the statement via FK — delete them first.
    const { error: rowsError } = await supabase
      .from("card_statement_rows")
      .delete()
      .eq("statement_id", statementId);
    if (rowsError) {
      return NextResponse.json({ error: rowsError.message }, { status: 400 });
    }

    const { error: stmtError } = await supabase
      .from("card_statements")
      .delete()
      .eq("id", statementId);
    if (stmtError) {
      return NextResponse.json({ error: stmtError.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "שגיאה לא צפויה.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
