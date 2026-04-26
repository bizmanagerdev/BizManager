import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { buildPaymentInsert, PAYMENT_SELECT } from "@/lib/payments";
import { isExpenseBusinessDomain, mapProjectTypeToExpenseDomain } from "@/lib/expenses";

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return NaN;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: string;
      business_domain?: string;
      project_id?: string;
      payment_date?: string | null;
      due_date?: string | null;
      amount_total?: number | string;
      requires_split?: boolean;
      payment_method?: string;
      reference_number?: string;
      notes?: string;
    };

    const paymentId = typeof body.id === "string" ? body.id.trim() : "";
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const paymentDate = typeof body.payment_date === "string" ? body.payment_date : null;
    const dueDate = typeof body.due_date === "string" ? body.due_date : null;
    const paymentMethod =
      typeof body.payment_method === "string" ? body.payment_method.trim() : "";
    const referenceNumber =
      typeof body.reference_number === "string" ? body.reference_number.trim() : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const amountNumber = toNumber(body.amount_total);
    const requiresSplit = body.requires_split === true;

    if (!paymentId || !projectId) {
      return NextResponse.json({ error: "Missing id or project_id" }, { status: 400 });
    }
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      return NextResponse.json({ error: "Missing or invalid amount_total" }, { status: 400 });
    }
    if (!paymentDate || !paymentMethod) {
      return NextResponse.json({ error: "Missing payment_date or payment_method" }, { status: 400 });
    }
    if (paymentMethod === "check" && !dueDate) {
      return NextResponse.json({ error: "Missing due_date for check payment" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    const { data: existingPayment, error: existingPaymentError } = await supabase
      .from("payments")
      .select("id,project_id,order_id,property_id,business_domain,payment_status")
      .eq("id", paymentId)
      .maybeSingle();

    if (existingPaymentError) {
      return NextResponse.json({ error: existingPaymentError.message }, { status: 400 });
    }
    if (!existingPayment?.id || existingPayment.project_id !== projectId) {
      return NextResponse.json({ error: "Payment not found for project" }, { status: 404 });
    }

    const businessDomain = isExpenseBusinessDomain(body.business_domain)
      ? body.business_domain
      : mapProjectTypeToExpenseDomain(null);
    const nextPaymentStatus =
      existingPayment.payment_status === "rejected"
        ? "rejected"
        : paymentMethod === "check"
        ? "pending"
        : "cleared";

    const { recorded_by: ignoredRecordedBy, ...paymentValues } = buildPaymentInsert({
      amountTotal: amountNumber,
      businessDomain: isExpenseBusinessDomain(existingPayment.business_domain)
        ? existingPayment.business_domain
        : businessDomain,
      paymentDate,
      paymentMethod,
      paymentStatus: nextPaymentStatus,
      projectId,
      orderId: existingPayment.order_id,
      propertyId: existingPayment.property_id,
      referenceNumber,
      notes,
      dueDate: paymentMethod === "check" ? dueDate : null,
      requiresSplit,
      recordedBy: user.id,
    });
    void ignoredRecordedBy;

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .update(paymentValues)
      .eq("id", paymentId)
      .select(PAYMENT_SELECT)
      .maybeSingle();

    if (paymentError) return NextResponse.json({ error: paymentError.message }, { status: 400 });

    return NextResponse.json({ payment });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
