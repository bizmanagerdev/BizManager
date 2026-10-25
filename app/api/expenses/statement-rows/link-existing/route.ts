import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { loadStatementCardAccount } from "@/lib/financial/cardAccountStatement";

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
      .select("id,statement_id,amount")
      .eq("id", rowId)
      .maybeSingle();
    if (rowErr) return NextResponse.json({ error: toHebrewError(rowErr.message) }, { status: 400 });
    if (!row?.id) return NextResponse.json({ error: "השורה לא נמצאה." }, { status: 404 });

    // A US card kept as its own account (2026-10-25): the purchase typed by hand
    // (on Chase, say, or with no account) moves onto the card's account, at the
    // statement's dollars — the card's page is its statement, and the bank it
    // was typed on never paid it.
    const loaded = await loadStatementCardAccount(supabase, String(row.statement_id ?? ""));
    if ("error" in loaded) return NextResponse.json({ error: toHebrewError(loaded.error) }, { status: 400 });
    const card = loaded.account;
    if (card) {
      const dollars = Math.round(Math.abs(Number(row.amount ?? 0)) * 100) / 100;
      const { error: moveErr } = await supabase
        .from("expenses")
        .update({
          account_id: card.cardAccountId,
          payment_method: "credit_card",
          currency: card.currency,
          foreign_amount: dollars,
          // The day's rate for the new dollars (the database fills it in).
          fx_rate: null,
          fx_rate_manual: false,
        })
        .eq("id", expenseId);
      if (moveErr) return NextResponse.json({ error: toHebrewError(moveErr.message) }, { status: 400 });
    }

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
