import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getCollectionsData } from "@/lib/collections";

// Just the "who owes money" roster — customer, phone, and how much is open.
// Powers the customer picker in the top-bar קליטת תשלום dialog, which deliberately
// only offers customers with something to collect (picking from ALL customers
// would bury the handful that actually matter).
export async function GET() {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;

    const data = await getCollectionsData(access.value.supabase);
    const debtors = data.customers
      .filter((group) => group.customer_id && group.outstanding_amount > 0)
      .map((group) => ({
        customer_id: group.customer_id as string,
        customer_name: group.customer_name,
        customer_phone: group.customer_phone,
        outstanding_amount: group.outstanding_amount,
        overdue_amount: group.overdue_amount,
      }));

    return NextResponse.json({ debtors });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "טעינת החייבים נכשלה.") }, { status: 500 });
  }
}
