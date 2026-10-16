import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { roundShekels } from "@/lib/financial/cardStatementMath";

// "מול מזומן" — a card purchase swiped for someone who handed us its amount in
// cash (owner, 2026-10-15). The line stays inside the card's bill and its bank
// charge (the bank did take it), is never an expense, and its cash goes into the
// cash box as a transfer between our own accounts: an account_transfers row with
// no "from" — its OUT side is the card charge already on the books, so
// lib/accounts.ts writes only the IN leg. The line is also left out ("לא
// לתיעוד"), so nothing that counts waiting lines can turn it into an expense.
//
// POST   { row_id, account_id, date } — record it.
// DELETE { row_id }                   — undo: the cash entry goes, the line waits for שיוך again.
// Admin/office.

type RowRecord = { id: string; amount: number | null; expense_id: string | null; income_payment_id: string | null };

async function readBody(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return { rowId: text(body.row_id), accountId: text(body.account_id), date: text(body.date) };
}

export async function POST(req: Request) {
  try {
    const { rowId, accountId, date } = await readBody(req);
    if (!rowId) return NextResponse.json({ error: "חסרה שורה." }, { status: 400 });
    if (!accountId) return NextResponse.json({ error: "יש לבחור לאיזה חשבון נכנס המזומן." }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "יש לבחור תאריך." }, { status: 400 });

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const { data: rowData, error: rowError } = await supabase
      .from("card_statement_rows")
      .select("id,amount,expense_id,income_payment_id")
      .eq("id", rowId)
      .maybeSingle();
    if (rowError) return NextResponse.json({ error: toHebrewError(rowError.message) }, { status: 400 });
    const row = rowData as RowRecord | null;
    if (!row) return NextResponse.json({ error: "השורה לא נמצאה." }, { status: 404 });
    const amount = roundShekels(Number(row.amount ?? 0));
    if (!(amount > 0)) return NextResponse.json({ error: "רק קנייה יכולה להיות מול מזומן." }, { status: 400 });
    if (row.expense_id) return NextResponse.json({ error: "לשורה כבר נרשמה הוצאה." }, { status: 400 });
    if (row.income_payment_id) return NextResponse.json({ error: "לשורה כבר נרשמה הכנסה." }, { status: 400 });

    const { data: inserted, error: insertError } = await supabase
      .from("account_transfers")
      .insert({
        from_account_id: null,
        to_account_id: accountId,
        amount,
        transfer_date: date,
        notes: null,
        card_statement_row_id: rowId,
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (insertError) {
      // The unique index on card_statement_row_id: a second click, or another screen, got there first.
      if (insertError.code === "23505") return NextResponse.json({ error: "השורה כבר רשומה מול מזומן." }, { status: 409 });
      return NextResponse.json({ error: toHebrewError(insertError.message) }, { status: 400 });
    }
    const transferId = (inserted as { id: string }).id;

    const { error: updateError } = await supabase.from("card_statement_rows").update({ include: false }).eq("id", rowId);
    if (updateError) {
      // Without the line left out it could still become an expense — take the cash entry back out.
      await supabase.from("account_transfers").delete().eq("id", transferId);
      return NextResponse.json({ error: toHebrewError(updateError.message) }, { status: 400 });
    }

    return NextResponse.json({ transfer_id: transferId });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "הרישום מול מזומן נכשל.") }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { rowId } = await readBody(req);
    if (!rowId) return NextResponse.json({ error: "חסרה שורה." }, { status: 400 });

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { error: deleteError } = await supabase.from("account_transfers").delete().eq("card_statement_row_id", rowId);
    if (deleteError) return NextResponse.json({ error: toHebrewError(deleteError.message) }, { status: 400 });

    const { error: updateError } = await supabase
      .from("card_statement_rows")
      .update({ include: true })
      .eq("id", rowId)
      .is("expense_id", null);
    if (updateError) return NextResponse.json({ error: toHebrewError(updateError.message) }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "ביטול הרישום מול מזומן נכשל.") }, { status: 500 });
  }
}
