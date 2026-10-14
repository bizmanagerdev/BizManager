import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getCustomerActivity } from "@/lib/communications";
import { getCustomerReceivables } from "@/lib/collections";

// Communication logs + reminders + open receivables for one customer — feeds the
// גבייה panel (call log, follow-ups, and what the customer still owes).
// `receivables=0`: the call log and reminders only — what the panel re-reads
// after a call or a reminder, which leave the debt as it was (the receivables
// are the heavy part of this answer).
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const customerId = url.searchParams.get("customer_id")?.trim() ?? "";
    if (!customerId) {
      return NextResponse.json({ error: "חסר מזהה לקוח." }, { status: 400 });
    }
    const withReceivables = url.searchParams.get("receivables") !== "0";

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const [activity, receivables] = await Promise.all([
      getCustomerActivity(supabase, customerId),
      withReceivables ? getCustomerReceivables(supabase, customerId).catch(() => []) : Promise.resolve(undefined),
    ]);
    return NextResponse.json(withReceivables ? { ...activity, receivables } : activity);
  } catch (err: unknown) {
    const message = toHebrewError(err, "טעינת הגבייה נכשלה.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
