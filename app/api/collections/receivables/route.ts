import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getCustomerReceivables } from "@/lib/collections";

// What ONE customer still owes, per source (order / project / loan). The
// collections activity route returns this too, but bundled with the whole call
// log + reminders — the קליטת תשלום dialog wants only the debts.
export async function GET(req: Request) {
  try {
    const customerId = new URL(req.url).searchParams.get("customer_id")?.trim() ?? "";
    if (!customerId) return NextResponse.json({ error: "Missing customer_id" }, { status: 400 });

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;

    const receivables = await getCustomerReceivables(access.value.supabase, customerId).catch(() => []);
    return NextResponse.json({ receivables });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "טעינת החובות נכשלה.") }, { status: 500 });
  }
}
