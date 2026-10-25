import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// Returns existing expenses within a date window so the importer can flag
// rows that already appear in the system (matched on amount + date proximity).
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { from?: string; to?: string; currency?: string };
    const from = typeof body.from === "string" ? body.from.trim() : "";
    const to = typeof body.to === "string" ? body.to.trim() : "";
    // A US card's statement (2026-10-25) is matched against expenses in its own
    // currency, by their dollars — a purchase typed by hand on Chase, say.
    const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
    const foreign = currency === "USD" || currency === "CAD" ? currency : null;
    if (!isIso(from) || !isIso(to)) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    // Match on either date column: prior credit-card imports store the billing date in
    // expense_date and the spend date in transaction_date, so a row can fall in range by
    // either one.
    let query = supabase
      .from("expenses")
      .select("id,expense_date,transaction_date,amount,description" + (foreign ? ",foreign_amount" : ""))
      .or(
        `and(expense_date.gte.${from},expense_date.lte.${to}),and(transaction_date.gte.${from},transaction_date.lte.${to})`
      );
    if (foreign) query = query.eq("currency", foreign);
    const { data, error } = await query.limit(5000);

    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });

    const expenses = foreign
      ? ((data ?? []) as unknown as Array<Record<string, unknown>>).map(({ foreign_amount, ...e }) => ({ ...e, amount: foreign_amount }))
      : data ?? [];
    return NextResponse.json({ expenses });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
