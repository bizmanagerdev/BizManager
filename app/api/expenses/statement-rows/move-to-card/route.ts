import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Moves expenses that were typed by hand with a bank account, and later matched to a
// credit-card statement line, into that card's bank charge: the expense keeps its
// amount, domain, date and project, and stops leaving the bank account by itself.
// Without this the bank balance counts the purchase twice — once on its own and once
// inside the card's one-line charge (found 2026-10-13: ₪6,688.00 on הלר בית 8.26 and
// ₪210.00 on הלר עסקי 7.26). Only expenses linked to a line of the given statement are
// touched. Admin/office.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { statement_id?: string; expense_ids?: unknown };
    const statementId = typeof body.statement_id === "string" ? body.statement_id.trim() : "";
    const expenseIds = (Array.isArray(body.expense_ids) ? body.expense_ids : [])
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim());
    if (!statementId || expenseIds.length === 0) {
      return NextResponse.json({ error: "חסרים פירוט או הוצאות." }, { status: 400 });
    }

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data: linked, error: linkError } = await supabase
      .from("card_statement_rows")
      .select("expense_id")
      .eq("statement_id", statementId)
      .in("expense_id", expenseIds);
    if (linkError) return NextResponse.json({ error: toHebrewError(linkError.message) }, { status: 400 });
    const allowed = [...new Set(((linked ?? []) as Array<{ expense_id: string | null }>).map((r) => r.expense_id))].filter(
      (id): id is string => Boolean(id)
    );
    if (allowed.length === 0) return NextResponse.json({ error: "ההוצאות לא שייכות לפירוט הזה." }, { status: 400 });

    const { data: updated, error: updateError } = await supabase
      .from("expenses")
      .update({ account_id: null, payment_method: "credit_card" })
      .in("id", allowed)
      .select("id");
    if (updateError) return NextResponse.json({ error: toHebrewError(updateError.message) }, { status: 400 });

    return NextResponse.json({ moved: (updated ?? []).length });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "העברת ההוצאות לחיוב הכרטיס נכשלה.") }, { status: 500 });
  }
}
