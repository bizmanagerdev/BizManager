import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Tick (or untick) one line of an account's register as "נבדק מול הבנק" —
// compared against the bank statement (owner, 2026-10-18).
//
// A line is named the way the register names it (AccountLedgerEntry.id —
// "p:<payment>", "e:<expense>", "t:<transfer>:out", "ccb:<account>:<date>"…)
// plus its account. The line's amount (signed: in positive, out negative) and
// date are kept with the tick, so an edited line shows as unchecked again.
//
// Not written to the audit log: a tick moves no money, the row itself keeps who
// ticked it and when, and a reconciliation session is dozens of ticks.

type Body = {
  account_id?: string;
  entry_key?: string;
  amount?: number;
  date?: string;
  checked?: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ENTRY_KEY = /^[a-z]{1,3}:\S{1,200}$/;

function isMissingTable(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("does not exist") || m.includes("could not find");
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as Body;
    const accountId = typeof body.account_id === "string" ? body.account_id.trim() : "";
    const entryKey = typeof body.entry_key === "string" ? body.entry_key.trim() : "";
    const date = typeof body.date === "string" ? body.date.trim().slice(0, 10) : "";
    const amount = typeof body.amount === "number" && Number.isFinite(body.amount) ? Math.round(body.amount * 100) / 100 : null;
    const checked = body.checked !== false;

    if (!accountId) return NextResponse.json({ error: "לא נבחר חשבון." }, { status: 400 });
    if (!ENTRY_KEY.test(entryKey)) return NextResponse.json({ error: "השורה אינה מזוהה." }, { status: 400 });

    if (checked) {
      if (amount === null) return NextResponse.json({ error: "סכום השורה אינו תקין." }, { status: 400 });
      if (!ISO_DATE.test(date)) return NextResponse.json({ error: "תאריך השורה אינו תקין." }, { status: 400 });
      const { error } = await supabase.from("account_ledger_checks").upsert(
        {
          account_id: accountId,
          entry_key: entryKey,
          amount_at_check: amount,
          date_at_check: date,
          checked_by: profile.id,
          checked_at: new Date().toISOString(),
        },
        { onConflict: "account_id,entry_key" }
      );
      if (error) {
        if (isMissingTable(error.message)) {
          return NextResponse.json(
            { error: "סימון \"נבדק מול הבנק\" עדיין לא זמין — יש להריץ את המיגרציה account_ledger_checks." },
            { status: 400 }
          );
        }
        return NextResponse.json({ error: toHebrewError(error.message, "שמירת הסימון נכשלה.") }, { status: 400 });
      }
    } else {
      const { error } = await supabase
        .from("account_ledger_checks")
        .delete()
        .eq("account_id", accountId)
        .eq("entry_key", entryKey);
      if (error) return NextResponse.json({ error: toHebrewError(error.message, "ביטול הסימון נכשל.") }, { status: 400 });
    }

    return NextResponse.json({ ok: true, checked });
  } catch (error) {
    return NextResponse.json({ error: toHebrewError(error, "שמירת הסימון נכשלה.") }, { status: 500 });
  }
}
