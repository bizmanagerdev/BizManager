import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getCustomerActivity } from "@/lib/communications";

// Communication logs + reminders for one customer — feeds the מעקב גבייה panel.
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

    const activity = await getCustomerActivity(supabase, customerId);
    return NextResponse.json(activity);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
