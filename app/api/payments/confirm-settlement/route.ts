import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";

// Confirm (or un-confirm) that a credit-card clearing deposit landed.
//
// A deposit is identified the way the app groups one: the account it lands in
// plus its settlement date. Confirming it is what moves it from "expected" to
// "arrived" on צפי תזרים and makes it appear in the account's register — until
// now that happened automatically on the date, whether or not the money came.
//
// Un-confirming exists for the obvious mistake (wrong day, wrong account); it
// just removes the record.

type Body = {
  account_id?: string;
  settlement_date?: string;
  confirmed?: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isMissingTable(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("does not exist") || m.includes("could not find");
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as Body;
    const accountId = typeof body.account_id === "string" ? body.account_id.trim() : "";
    const settlementDate = typeof body.settlement_date === "string" ? body.settlement_date.trim().slice(0, 10) : "";
    const confirmed = body.confirmed !== false;

    // A deposit with no account has nowhere to land, so it can't be confirmed.
    if (!accountId) return NextResponse.json({ error: "להפקדה זו לא משויך חשבון." }, { status: 400 });
    if (!ISO_DATE.test(settlementDate)) return NextResponse.json({ error: "תאריך ההפקדה אינו תקין." }, { status: 400 });

    if (confirmed) {
      const { error } = await supabase
        .from("card_settlement_confirmations")
        .upsert(
          { account_id: accountId, settlement_date: settlementDate, confirmed_by: profile.id, confirmed_at: new Date().toISOString() },
          { onConflict: "account_id,settlement_date" }
        );
      if (error) {
        if (isMissingTable(error.message)) {
          return NextResponse.json(
            { error: "אישור הפקדות עדיין לא זמין — יש להריץ את המיגרציה card_settlement_confirmations." },
            { status: 400 }
          );
        }
        return NextResponse.json({ error: toHebrewError(error.message, "אישור ההפקדה נכשל.") }, { status: 400 });
      }
    } else {
      const { error } = await supabase
        .from("card_settlement_confirmations")
        .delete()
        .eq("account_id", accountId)
        .eq("settlement_date", settlementDate);
      if (error) return NextResponse.json({ error: toHebrewError(error.message, "ביטול האישור נכשל.") }, { status: 400 });
    }

    await logAuditEvent({
      supabase,
      tableName: "card_settlement_confirmations",
      recordId: `${accountId}|${settlementDate}`,
      action: confirmed ? "create" : "delete",
      changedBy: profile.id,
      userRole: profile.role,
      newData: confirmed ? { account_id: accountId, settlement_date: settlementDate } : undefined,
    }).catch(() => {});

    return NextResponse.json({ ok: true, confirmed });
  } catch (error) {
    return NextResponse.json({ error: toHebrewError(error, "אישור ההפקדה נכשל.") }, { status: 500 });
  }
}
