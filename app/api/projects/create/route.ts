import { toHebrewError } from "@/lib/error-messages";
﻿import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { computeDueDate, normalizePaymentTerms } from "@/lib/paymentTerms";
import { getCurrentVatRate } from "@/lib/settings/vat";
import { notifyNewEntity } from "@/lib/notifications/new-entity";

type CreateProjectPayload = {
  customer_id?: string;
  branch_id?: string | null;
  name?: string;
  project_type?: string;
  status?: string;
  agreed_base_price?: number | string;
  actual_price?: number | string;
  price_includes_vat?: boolean;
  no_charge?: boolean;
  expenses_billed_separately?: boolean;
  project_manager_id?: string | null;
  start_date?: string;
  end_date?: string | null;
  payment_terms?: string | null;
  due_date?: string | null;
  notes?: string | null;
  items_to_move?: string[] | null;
  origin_address?: string | null;
  origin_floor?: string | null;
  origin_has_elevator?: boolean | null;
  destination_address?: string | null;
  destination_floor?: string | null;
  destination_has_elevator?: boolean | null;
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

function toTrimmedOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toBoolOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    return await withIdempotency(req, supabase, user.id, "projects/create", async () => {
    const body = (await req.json()) as CreateProjectPayload;

    const customerId = typeof body.customer_id === "string" ? body.customer_id : "";
    const branchId = typeof body.branch_id === "string" && body.branch_id.trim() ? body.branch_id.trim() : null;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const projectType = typeof body.project_type === "string" ? body.project_type : "";
    const status = typeof body.status === "string" ? body.status : "";
    // No-charge (donation / favor / internal): the price is intentionally 0.
    const noCharge = Boolean(body.no_charge);
    const agreedBasePriceRaw = body.agreed_base_price;
    const agreedBasePrice = noCharge
      ? 0
      : agreedBasePriceRaw === undefined || agreedBasePriceRaw === null || agreedBasePriceRaw === ""
        ? 0
        : toNumber(agreedBasePriceRaw);
    const actualPrice = agreedBasePrice;
    const priceIncludesVat = Boolean(body.price_includes_vat);
    const expensesBilledSeparately = Boolean(body.expenses_billed_separately);
    const projectManagerId = typeof body.project_manager_id === "string" ? body.project_manager_id : null;
    const startDate = typeof body.start_date === "string" ? body.start_date : "";
    const endDate = typeof body.end_date === "string" ? body.end_date : null;
    const paymentTerms = normalizePaymentTerms(body.payment_terms);
    const dueDate =
      typeof body.due_date === "string" && body.due_date.trim()
        ? body.due_date.trim()
        : computeDueDate(startDate, paymentTerms);
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const itemsToMove = sanitizeStringArray(body.items_to_move);
    // Moving-only origin → destination addresses (each: address + floor + elevator).
    const isMoving = projectType === "moving";
    const originAddress = isMoving ? toTrimmedOrNull(body.origin_address) : null;
    const originFloor = isMoving ? toTrimmedOrNull(body.origin_floor) : null;
    const originHasElevator = isMoving ? toBoolOrNull(body.origin_has_elevator) : null;
    const destinationAddress = isMoving ? toTrimmedOrNull(body.destination_address) : null;
    const destinationFloor = isMoving ? toTrimmedOrNull(body.destination_floor) : null;
    const destinationHasElevator = isMoving ? toBoolOrNull(body.destination_has_elevator) : null;
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

    // Freeze the current rate onto price-includes-VAT projects so the gross
    // target stays stable if the global rate later changes.
    const projectVatRate = priceIncludesVat ? await getCurrentVatRate(supabase) : null;

    const { data: created, error: insertError } = await supabase
      .from("projects")
      .insert({
        customer_id: customerId,
        branch_id: branchId,
        name,
        project_type: projectType,
        status,
        agreed_base_price: agreedBasePrice,
        actual_price: actualPrice,
        price_includes_vat: priceIncludesVat,
        vat_rate: projectVatRate,
        no_charge: noCharge,
        expenses_billed_separately: expensesBilledSeparately,
        project_manager_id: projectManagerId,
        start_date: startDate || null,
        end_date: endDate,
        payment_terms: paymentTerms,
        due_date: dueDate,
        notes,
        items_to_move: isMoving ? itemsToMove : null,
        origin_address: originAddress,
        origin_floor: originFloor,
        origin_has_elevator: originHasElevator,
        destination_address: destinationAddress,
        destination_floor: destinationFloor,
        destination_has_elevator: destinationHasElevator,
      })
      .select(
        "id,customer_id,branch_id,name,project_type,status,agreed_base_price,actual_price,expenses_billed_separately,project_manager_id,start_date,end_date,payment_terms,due_date,notes,items_to_move,origin_address,origin_floor,origin_has_elevator,destination_address,destination_floor,destination_has_elevator,created_at,updated_at"
      )
      .maybeSingle();

    if (insertError) return NextResponse.json({ error: toHebrewError(insertError.message) }, { status: 400 });
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

    // Alert back-office (admin + office) that a new project came in.
    await notifyNewEntity({ kind: "project", entityId: created.id, creatorUserId: profile.id, name });

    return NextResponse.json({ project: dashboardRow ?? created });
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
