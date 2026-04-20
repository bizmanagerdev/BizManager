import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { buildPaymentInsert, PAYMENT_SELECT } from "@/lib/payments";
import {
  isExpenseBusinessDomain,
  mapProjectTypeToExpenseDomain,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";

type CreatePaymentPayload = {
  business_domain?: string;
  project_id?: string;
  order_id?: string;
  property_id?: string;
  payment_date?: string | null;
  amount_total?: number | string;
  payment_method?: string;
  reference_number?: string;
  notes?: string;
};

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return NaN;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreatePaymentPayload;
    const paymentDate = typeof body.payment_date === "string" ? body.payment_date : null;
    const paymentMethod =
      typeof body.payment_method === "string" ? body.payment_method.trim() : "";
    const referenceNumber =
      typeof body.reference_number === "string" ? body.reference_number.trim() : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
    const propertyId = typeof body.property_id === "string" ? body.property_id.trim() : "";
    const amountNumber = toNumber(body.amount_total);

    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      return NextResponse.json({ error: "Missing or invalid amount_total" }, { status: 400 });
    }
    if (!paymentDate || !paymentMethod) {
      return NextResponse.json({ error: "Missing payment_date or payment_method" }, { status: 400 });
    }

    const linkedIds = [projectId, orderId, propertyId].filter(Boolean);
    if (linkedIds.length !== 1) {
      return NextResponse.json(
        { error: "Exactly one of project_id, order_id, or property_id is required" },
        { status: 400 }
      );
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    let businessDomain: ExpenseBusinessDomain | null = isExpenseBusinessDomain(body.business_domain)
      ? body.business_domain
      : null;

    if (projectId) {
      const { data: project, error } = await supabase
        .from("projects")
        .select("id,project_type")
        .eq("id", projectId)
        .maybeSingle();

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

      if (!businessDomain) {
        businessDomain = mapProjectTypeToExpenseDomain(
          typeof project.project_type === "string" ? project.project_type : null
        );
      }
    }

    if (orderId) {
      const { data: order, error } = await supabase
        .from("orders")
        .select("id")
        .eq("id", orderId)
        .maybeSingle();

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

      if (!businessDomain) businessDomain = "sales";
    }

    if (propertyId) {
      const { data: property, error } = await supabase
        .from("properties")
        .select("id")
        .eq("id", propertyId)
        .maybeSingle();

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

      if (!businessDomain) businessDomain = "property_managment";
    }

    if (!businessDomain) {
      return NextResponse.json({ error: "Missing business_domain" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("payments")
      .insert(
        buildPaymentInsert({
          amountTotal: amountNumber,
          businessDomain,
          paymentDate,
          paymentMethod,
          projectId: projectId || null,
          orderId: orderId || null,
          propertyId: propertyId || null,
          referenceNumber,
          notes,
          recordedBy: user.id,
        })
      )
      .select(PAYMENT_SELECT)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ payment: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
