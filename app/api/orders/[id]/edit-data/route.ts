import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { hasDeliveriesAccess } from "@/lib/auth/roleAccess";
import { loadOrderEditData } from "@/lib/orders/order-edit-data";

// What the order edit dialog and the delivery confirmation load to edit an
// order (lib/orders/order-edit-data.ts — the same loader the edit page and
// the phone's copy use).

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;

  const { supabase, profile } = access.value;
  if (!hasDeliveriesAccess(profile.role, profile.section_access)) {
    return NextResponse.json({ error: "No access" }, { status: 403 });
  }
  const { id } = await context.params;
  // The delivery-confirmation dialog only shows the order's own lines (no
  // customer switch, no add-product picker) — see loadOrderEditData.
  const isConfirmScope = new URL(req.url).searchParams.get("scope") === "confirm";

  const result = await loadOrderEditData(supabase, id, { confirm: isConfirmScope });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
