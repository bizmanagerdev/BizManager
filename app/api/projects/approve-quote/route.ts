import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: string;
      agreed_base_price?: number | string;
    };

    const id = typeof body.id === "string" ? body.id.trim() : "";
    const agreedBasePrice = toNumber(body.agreed_base_price);

    if (!id) {
      return NextResponse.json({ error: "Missing project id" }, { status: 400 });
    }
    if (!Number.isFinite(agreedBasePrice) || agreedBasePrice <= 0) {
      return NextResponse.json({ error: "Invalid agreed_base_price" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data: updated, error: updateError } = await supabase
      .from("projects")
      .update({
        status: "planned",
        agreed_base_price: agreedBasePrice,
        actual_price: agreedBasePrice,
      })
      .eq("id", id)
      .select(
        "id,customer_id,name,project_type,status,agreed_base_price,actual_price,expenses_billed_separately,project_manager_id,start_date,end_date,notes,created_at,updated_at"
      )
      .maybeSingle();

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 });
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

    return NextResponse.json({ project: dashboardRow ?? updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
