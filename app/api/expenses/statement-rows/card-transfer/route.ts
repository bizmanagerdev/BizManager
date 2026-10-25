import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { loadRowStatementCardAccount, statementPricer } from "@/lib/financial/cardAccountStatement";

// A US card's statement line that is a move between our own accounts (owner,
// 2026-10-25: "each US card its own account, payments to it as transfers"):
//
//   payment       paying the card — a transfer from Chase / Capital One INTO
//                 the card account. Usually entered already, from the bank's
//                 side while matching the bank: then it is LINKED, not made
//                 again.
//   cash_advance  cash taken on the card — a transfer OUT of the card into
//                 the cash box.
//   a purchase    "מול מזומן" (someone handed us its amount in cash) — the
//                 same: out of the card, into the cash box; the line is then
//                 left out of the expenses.
//
// Unlike an Israeli card's "מול מזומן" (statement-rows/cash: no "from", its
// bank side is inside the card's lump charge), these are ordinary two-sided
// transfers: both accounts show them, and either side can edit or delete them.
// The line points at its transfer (card_statement_rows.transfer_id).
//
// POST   { row_id, transfer_id }                       — link one already entered.
// POST   { row_id, account_id, date, shekels? }        — make it: from that account (a
//                                                        payment) or into it (cash).
//                                                        `shekels`: what arrived in a ₪
//                                                        account (default: the day's rate).
// DELETE { row_id, delete_transfer? }                  — unlink; and delete the transfer too.
// Admin/office.

type RowRecord = {
  id: string;
  amount: number | string | null;
  line_kind: string | null;
  transfer_id: string | null;
  expense_id: string | null;
  income_payment_id: string | null;
  description: string | null;
  card_label: string | null;
  expense_date: string | null;
};

type AccountRecord = { id: string; name: string | null; currency: string | null };

// A transfer and its line may be dated a few days apart: the bank's day and the card's.
const LINK_WINDOW_DAYS = 10;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const cents = (n: number) => Math.round(n * 100);
const dayGap = (a: string, b: string) => Math.abs(Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86_400_000;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const rowId = text(body.row_id);
    const transferId = text(body.transfer_id);
    const accountId = text(body.account_id);
    const date = text(body.date);
    const shekelsTyped = typeof body.shekels === "number" && Number.isFinite(body.shekels) ? body.shekels : null;
    if (!rowId) return NextResponse.json({ error: "חסרה שורה." }, { status: 400 });

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const loaded = await loadRowStatementCardAccount(supabase, rowId);
    if ("error" in loaded) return NextResponse.json({ error: toHebrewError(loaded.error) }, { status: 400 });
    const card = loaded.account;
    if (!card) return NextResponse.json({ error: "הפירוט הזה אינו של כרטיס שמתנהל כחשבון." }, { status: 400 });

    const { data: rowData, error: rowError } = await supabase
      .from("card_statement_rows")
      .select("id,amount,line_kind,transfer_id,expense_id,income_payment_id,description,card_label,expense_date")
      .eq("id", rowId)
      .maybeSingle();
    if (rowError) return NextResponse.json({ error: toHebrewError(rowError.message) }, { status: 400 });
    const row = rowData as RowRecord | null;
    if (!row) return NextResponse.json({ error: "השורה לא נמצאה." }, { status: 404 });
    if (row.transfer_id) return NextResponse.json({ error: "השורה כבר מקושרת להעברה." }, { status: 409 });
    if (row.expense_id) return NextResponse.json({ error: "לשורה כבר נרשמה הוצאה." }, { status: 400 });
    if (row.income_payment_id) return NextResponse.json({ error: "לשורה כבר נרשמה הכנסה." }, { status: 400 });

    const kind = row.line_kind ?? "charge";
    const lineAmount = Math.abs(Number(row.amount ?? 0));
    if (!(lineAmount > 0)) return NextResponse.json({ error: "לשורה אין סכום." }, { status: 400 });
    // Into the card (a payment), or out of it into another account (cash).
    const intoCard = kind === "payment";
    if (!intoCard && Number(row.amount ?? 0) < 0) {
      return NextResponse.json({ error: "זיכוי נרשם כהכנסה, לא כהעברה." }, { status: 400 });
    }

    let linkedId = transferId;
    if (transferId) {
      // Link one already entered: it must be this card's, the same dollars, near the line's day.
      const { data: t, error: tError } = await supabase
        .from("account_transfers")
        .select("id,from_account_id,to_account_id,from_amount,to_amount,transfer_date")
        .eq("id", transferId)
        .maybeSingle();
      if (tError) return NextResponse.json({ error: toHebrewError(tError.message) }, { status: 400 });
      if (!t) return NextResponse.json({ error: "ההעברה לא נמצאה." }, { status: 404 });
      const cardSide = intoCard ? t.to_account_id : t.from_account_id;
      const cardAmount = Number((intoCard ? t.to_amount : t.from_amount) ?? NaN);
      if (cardSide !== card.cardAccountId) {
        return NextResponse.json({ error: intoCard ? "ההעברה לא נכנסה לכרטיס הזה." : "ההעברה לא יצאה מהכרטיס הזה." }, { status: 400 });
      }
      if (cents(cardAmount) !== cents(lineAmount)) {
        return NextResponse.json({ error: "הסכום של ההעברה שונה מהשורה." }, { status: 400 });
      }
      if (row.expense_date && t.transfer_date && dayGap(String(t.transfer_date), row.expense_date) > LINK_WINDOW_DAYS) {
        return NextResponse.json({ error: "ההעברה רחוקה יותר מ-10 ימים מהשורה." }, { status: 400 });
      }
    } else {
      if (!accountId) {
        return NextResponse.json({ error: intoCard ? "יש לבחור מאיזה חשבון שולם הכרטיס." : "יש לבחור לאיזה חשבון נכנס המזומן." }, { status: 400 });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "יש לבחור תאריך." }, { status: 400 });
      if (accountId === card.cardAccountId) return NextResponse.json({ error: "יש לבחור חשבון אחר מהכרטיס." }, { status: 400 });

      const { data: accData, error: accError } = await supabase
        .from("accounts")
        .select("id,name,currency")
        .eq("id", accountId)
        .maybeSingle();
      if (accError) return NextResponse.json({ error: toHebrewError(accError.message) }, { status: 400 });
      const other = accData as AccountRecord | null;
      if (!other) return NextResponse.json({ error: "החשבון לא נמצא." }, { status: 404 });
      const otherCurrency = String(other.currency ?? "ILS").toUpperCase();

      // The other side in its own currency: the same dollars on a dollar account;
      // on a shekel account what arrived (or left), typed or at the day's rate.
      let shekels: number | null = null;
      if (otherCurrency === "ILS") {
        if (shekelsTyped !== null && shekelsTyped > 0) shekels = Math.round(shekelsTyped * 100) / 100;
        else {
          const priced = await statementPricer(supabase, card.currency)(lineAmount, date);
          if ("error" in priced) return NextResponse.json({ error: priced.error }, { status: 400 });
          shekels = priced.shekels;
        }
      } else if (otherCurrency !== card.currency) {
        return NextResponse.json({ error: `החשבון "${other.name}" אינו ב-${card.currency}.` }, { status: 400 });
      }

      const label = row.card_label?.trim() || "כרטיס";
      const what = row.description?.trim() || "";
      const cardSide = lineAmount;
      const insert = intoCard
        ? {
            from_account_id: other.id,
            to_account_id: card.cardAccountId,
            from_amount: otherCurrency === "ILS" ? null : cardSide,
            to_amount: cardSide,
            // Shekels that left a ₪ bank; between two dollar accounts the database prices it.
            amount: shekels ?? cardSide,
            notes: `תשלום לכרטיס ${label}${what ? `: ${what}` : ""}`,
          }
        : {
            from_account_id: card.cardAccountId,
            to_account_id: other.id,
            from_amount: cardSide,
            to_amount: otherCurrency === "ILS" ? null : cardSide,
            amount: shekels ?? cardSide,
            notes: `${kind === "cash_advance" ? "משיכת מזומן" : "מזומן מול"} כרטיס ${label}${what ? `: ${what}` : ""}`,
          };
      const { data: inserted, error: insertError } = await supabase
        .from("account_transfers")
        .insert({ ...insert, transfer_date: date, created_by: profile.id })
        .select("id")
        .single();
      if (insertError) return NextResponse.json({ error: toHebrewError(insertError.message) }, { status: 400 });
      linkedId = (inserted as { id: string }).id;
    }

    // Only a line not linked yet, so two clicks can't both link it.
    const patch: Record<string, unknown> = { transfer_id: linkedId };
    if (kind === "charge") patch.include = false; // "מול מזומן": not an expense any more
    const { data: updated, error: updateError } = await supabase
      .from("card_statement_rows")
      .update(patch)
      .eq("id", rowId)
      .is("transfer_id", null)
      .select("id");
    if (updateError || !updated || updated.length === 0) {
      // A transfer made here for nothing: take it back out. One linked from the bank stays.
      if (!transferId) await supabase.from("account_transfers").delete().eq("id", linkedId);
      if (updateError?.code === "23505") {
        return NextResponse.json({ error: "ההעברה הזאת כבר מקושרת לשורה אחרת." }, { status: 409 });
      }
      return NextResponse.json({ error: updateError ? toHebrewError(updateError.message) : "השורה כבר מקושרת." }, { status: 409 });
    }
    return NextResponse.json({ transfer_id: linkedId, created: !transferId });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "הרישום נכשל.") }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const rowId = text(body.row_id);
    const deleteTransfer = body.delete_transfer === true;
    if (!rowId) return NextResponse.json({ error: "חסרה שורה." }, { status: 400 });

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data: rowData, error: rowError } = await supabase
      .from("card_statement_rows")
      .select("id,line_kind,transfer_id,expense_id")
      .eq("id", rowId)
      .maybeSingle();
    if (rowError) return NextResponse.json({ error: toHebrewError(rowError.message) }, { status: 400 });
    const row = rowData as Pick<RowRecord, "id" | "line_kind" | "transfer_id" | "expense_id"> | null;
    if (!row) return NextResponse.json({ error: "השורה לא נמצאה." }, { status: 404 });
    if (!row.transfer_id) return NextResponse.json({ ok: true });

    const patch: Record<string, unknown> = { transfer_id: null };
    // A purchase that was "מול מזומן" waits for שיוך again.
    if ((row.line_kind ?? "charge") === "charge" && !row.expense_id) patch.include = true;
    const { error: updateError } = await supabase.from("card_statement_rows").update(patch).eq("id", rowId);
    if (updateError) return NextResponse.json({ error: toHebrewError(updateError.message) }, { status: 400 });

    if (deleteTransfer) {
      const { error: deleteError } = await supabase.from("account_transfers").delete().eq("id", row.transfer_id);
      if (deleteError) return NextResponse.json({ error: toHebrewError(deleteError.message) }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "הביטול נכשל.") }, { status: 500 });
  }
}
