import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { deleteLoan, deleteRepayment } from "@/app/(app)/financial/loans/actions";

// Deleting one of the accounts page's register rows that has no route of its
// own: a loan (its repayments with it), a loan repayment, a card statement's
// charge, a transfer between accounts. The page deletes them in place (the
// loans' server actions, the browser's own Supabase delete); a delete made on
// the device copy first (lib/powersync/local-writes.ts) comes here instead,
// since the queue sends plain requests — the same deletes, under the same
// rules (admins only, as the page; RLS for the charge and the transfer).
//
// Deleting a row that's already gone does nothing and succeeds, so a delete
// sent again after its answer was lost is harmless.

type Body = { kind?: unknown; id?: unknown; loan_id?: unknown };

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const body = (await req.json().catch(() => ({}))) as Body;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return NextResponse.json({ error: "חסר מזהה הרשומה." }, { status: 400 });

    if (body.kind === "loan" || body.kind === "loan_repayment") {
      const loanId = typeof body.loan_id === "string" ? body.loan_id.trim() : "";
      const result = body.kind === "loan" ? await deleteLoan(id) : await deleteRepayment(id, loanId);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    const table =
      body.kind === "card_charge" ? "card_statement_charges" : body.kind === "transfer" ? "account_transfers" : null;
    if (!table) return NextResponse.json({ error: "סוג הרשומה אינו מוכר." }, { status: 400 });
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) return NextResponse.json({ error: toHebrewError(error.message, "המחיקה נכשלה.") }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: toHebrewError(error, "המחיקה נכשלה.") }, { status: 500 });
  }
}
