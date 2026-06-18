import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Links a statement row to an EXISTING expense (the one a duplicate check matched), instead of
// creating a new one. The row then reads as "created" — i.e. already accounted for. Used when
// the user confirms a flagged row is a duplicate of an expense already in the system.
// Recomputes the statement's created_count. Admin/office.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { row_id?: string; expense_id?: string };
    const rowId = typeof body.row_id === "string" ? body.row_id.trim() : "";
    const expenseId = typeof body.expense_id === "string" ? body.expense_id.trim() : "";
    if (!rowId || !expenseId) return NextResponse.json({ error: "חסר מזהה שורה או הוצאה." }, { status: 400 });

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    // Confirm the target expense exists before linking.
    const { data: expense, error: expErr } = await supabase
      .from("expenses")
      .select("id")
      .eq("id", expenseId)
      .maybeSingle();
    if (expErr) return NextResponse.json({ error: toHebrewError(expErr.message) }, { status: 400 });
    if (!expense?.id) return NextResponse.json({ error: "ההוצאה הקיימת לא נמצאה." }, { status: 404 });

    const { data: row, error: rowErr } = await supabase
      .from("card_statement_rows")
      .select("id,statement_id")
      .eq("id", rowId)
      .maybeSingle();
    if (rowErr) return NextResponse.json({ error: toHebrewError(rowErr.message) }, { status: 400 });
    if (!row?.id) return NextResponse.json({ error: "השורה לא נמצאה." }, { status: 404 });

    const { error: linkErr } = await supabase
      .from("card_statement_rows")
      .update({ expense_id: expenseId })
      .eq("id", rowId);
    if (linkErr) return NextResponse.json({ error: toHebrewError(linkErr.message) }, { status: 400 });

    // Keep the statement's created_count in sync (rows that now carry an expense).
    const statementId = typeof row.statement_id === "string" ? row.statement_id : "";
    if (statementId) {
      const { count } = await supabase
        .from("card_statement_rows")
        .select("id", { count: "exact", head: true })
        .eq("statement_id", statementId)
        .not("expense_id", "is", null);
      await supabase.from("card_statements").update({ created_count: count ?? 0 }).eq("id", statementId);
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = toHebrewError(err, "הקישור נכשל.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
