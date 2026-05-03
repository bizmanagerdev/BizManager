import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type CreateProjectPayload = {
  customer_id?: string;
  name?: string;
  project_type?: string;
  status?: string;
  agreed_base_price?: number | string;
  actual_price?: number | string;
  expenses_billed_separately?: boolean;
  project_manager_id?: string | null;
  start_date?: string;
  end_date?: string | null;
  notes?: string | null;
  items_to_move?: string[] | null;
};

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function sanitizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return null;
  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateProjectPayload;

    const customerId = typeof body.customer_id === "string" ? body.customer_id : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const projectType = typeof body.project_type === "string" ? body.project_type : "";
    const status = typeof body.status === "string" ? body.status : "";
    const agreedBasePriceRaw = body.agreed_base_price;
    const agreedBasePrice =
      agreedBasePriceRaw === undefined || agreedBasePriceRaw === null || agreedBasePriceRaw === ""
        ? 0
        : toNumber(agreedBasePriceRaw);
    const actualPrice = agreedBasePrice;
    const expensesBilledSeparately = Boolean(body.expenses_billed_separately);
    const projectManagerId = typeof body.project_manager_id === "string" ? body.project_manager_id : null;
    const startDate = typeof body.start_date === "string" ? body.start_date : "";
    const endDate = typeof body.end_date === "string" ? body.end_date : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const itemsToMove = sanitizeStringArray(body.items_to_move);
    const allowedProjectTypes = new Set([
      "logistics",
      "construction",
      "moving",
      "other",
      "home",
    ]);

    if (!customerId || !name || !projectType || !status) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!allowedProjectTypes.has(projectType)) {
      return NextResponse.json({ error: "Invalid project_type" }, { status: 400 });
    }
    if (!Number.isFinite(agreedBasePrice) || agreedBasePrice < 0 || !Number.isFinite(actualPrice)) {
      return NextResponse.json({ error: "Invalid prices" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const { data: created, error: insertError } = await supabase
      .from("projects")
      .insert({
        customer_id: customerId,
        name,
        project_type: projectType,
        status,
        agreed_base_price: agreedBasePrice,
        actual_price: actualPrice,
        expenses_billed_separately: expensesBilledSeparately,
        project_manager_id: projectManagerId,
        start_date: startDate || null,
        end_date: endDate,
        notes,
        items_to_move: projectType === "moving" ? itemsToMove : null,
      })
      .select(
        "id,customer_id,name,project_type,status,agreed_base_price,actual_price,expenses_billed_separately,project_manager_id,start_date,end_date,notes,items_to_move,created_at,updated_at"
      )
      .maybeSingle();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 400 });
    if (!created || typeof created.id !== "string") {
      return NextResponse.json({ error: "Project was not created" }, { status: 400 });
    }

    const { data: dashboardRow } = await supabase
      .from("project_dashboard_view")
      .select(
        "id,name,status,project_type,start_date,end_date,agreed_base_price,actual_price,customer_id,customer_name,project_manager_id,project_manager_name,created_at,updated_at,total_expenses,gross_profit,total_tasks,completed_tasks,open_tasks"
      )
      .eq("id", created.id)
      .maybeSingle();

    await logAuditEvent({
      supabase,
      tableName: "projects",
      recordId: created.id,
      action: "create",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ project: dashboardRow ?? created });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
