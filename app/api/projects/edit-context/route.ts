import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// The full project row behind an edit form.
//
// The projects LIST is served by project_dashboard_view, which carries only what
// the list draws — no branch, VAT mode, no-charge flag, payment terms, due date,
// notes, items or addresses. The edit wizard submits every field it holds, so
// opening it straight from a list row used to save those fields back as empty.
// The wizard reads the real row through here first.

const PROJECT_EDIT_COLUMNS =
  "id,customer_id,branch_id,name,project_type,status,agreed_base_price,actual_price,price_includes_vat,vat_rate,no_charge,expenses_billed_separately,project_manager_id,start_date,end_date,payment_terms,due_date,notes,items_to_move,origin_address,origin_floor,origin_has_elevator,destination_address,destination_floor,destination_has_elevator";

export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
    if (!id) return NextResponse.json({ error: "חסר מזהה פרויקט." }, { status: 400 });

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data, error } = await supabase.from("projects").select(PROJECT_EDIT_COLUMNS).eq("id", id).maybeSingle();
    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    if (!data) return NextResponse.json({ error: "הפרויקט לא נמצא." }, { status: 404 });

    return NextResponse.json({ project: data });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "טעינת הפרויקט נכשלה.") }, { status: 500 });
  }
}
