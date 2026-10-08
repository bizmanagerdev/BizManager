import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { logAuditEventAfterResponse } from "@/lib/audit-after";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { projectRowFrom } from "@/lib/projects/project-input";
import { getCurrentVatRate } from "@/lib/settings/vat";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;

    const id = typeof body.id === "string" ? body.id : "";
    // The same row the create route and the phone build (lib/projects/project-input.ts).
    const parsed = projectRowFrom(body);
    if (!id) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { row } = parsed;

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    // Freeze the rate when turning the VAT-in-price mode on; preserve a
    // previously frozen rate; clear it when the mode is off.
    let projectVatRate: number | null = null;
    if (row.price_includes_vat) {
      const { data: existingProject } = await supabase
        .from("projects")
        .select("vat_rate")
        .eq("id", id)
        .maybeSingle();
      const existingRate =
        typeof existingProject?.vat_rate === "number"
          ? existingProject.vat_rate
          : Number(existingProject?.vat_rate);
      projectVatRate =
        Number.isFinite(existingRate) && existingRate > 0
          ? existingRate
          : await getCurrentVatRate(supabase);
    }

    const { data: updated, error: updateError } = await supabase
      .from("projects")
      .update({ ...row, vat_rate: projectVatRate })
      .eq("id", id)
      .select(
        "id,customer_id,branch_id,name,project_type,status,agreed_base_price,actual_price,expenses_billed_separately,project_manager_id,start_date,end_date,payment_terms,due_date,notes,items_to_move,origin_address,origin_floor,origin_has_elevator,destination_address,destination_floor,destination_has_elevator,created_at,updated_at"
      )
      .maybeSingle();

    if (updateError) return NextResponse.json({ error: toHebrewError(updateError.message) }, { status: 400 });
    if (!updated || typeof updated.id !== "string") {
      return NextResponse.json({ error: "Project was not updated" }, { status: 400 });
    }

    const { data: dashboardRow } = await supabase
      .from("project_dashboard_view")
      .select(
        "id,name,status,project_type,start_date,end_date,agreed_base_price,actual_price,customer_id,customer_name,project_manager_id,project_manager_name,created_at,updated_at,total_expenses,gross_profit,total_tasks,completed_tasks,open_tasks"
      )
      .eq("id", updated.id)
      .maybeSingle();

    logAuditEventAfterResponse({
      supabase,
      tableName: "projects",
      recordId: updated.id,
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ project: dashboardRow ?? updated });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
