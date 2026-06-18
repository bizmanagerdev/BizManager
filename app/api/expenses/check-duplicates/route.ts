import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// Returns existing expenses within a date window so the importer can flag
// rows that already appear in the system (matched on amount + date proximity).
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { from?: string; to?: string };
    const from = typeof body.from === "string" ? body.from.trim() : "";
    const to = typeof body.to === "string" ? body.to.trim() : "";
    if (!isIso(from) || !isIso(to)) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    // Match on either date column: prior credit-card imports store the billing date in
    // expense_date and the spend date in transaction_date, so a row can fall in range by
    // either one.
    const { data, error } = await supabase
      .from("expenses")
      .select("id,expense_date,transaction_date,amount,description")
      .or(
        `and(expense_date.gte.${from},expense_date.lte.${to}),and(transaction_date.gte.${from},transaction_date.lte.${to})`
      )
      .limit(5000);

    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });

    return NextResponse.json({ expenses: data ?? [] });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
