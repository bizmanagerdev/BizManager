import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getCustomerActivity } from "@/lib/communications";
import { getCustomerReceivables } from "@/lib/collections";

// Communication logs + reminders + open receivables for one customer — feeds the
// מעקב גבייה panel (call log, follow-ups, and what the customer still owes).
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const customerId = url.searchParams.get("customer_id")?.trim() ?? "";
    if (!customerId) {
      return NextResponse.json({ error: "Missing customer_id" }, { status: 400 });
    }

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const [activity, receivables] = await Promise.all([
      getCustomerActivity(supabase, customerId),
      getCustomerReceivables(supabase, customerId).catch(() => []),
    ]);
    return NextResponse.json({ ...activity, receivables });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
