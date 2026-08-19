import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { buildPaymentInsert, PAYMENT_SELECT } from "@/lib/payments";
import { getCurrentVatRate } from "@/lib/settings/vat";
import { isExpenseBusinessDomain, mapProjectTypeToExpenseDomain } from "@/lib/expenses";
import { parseTagIds, syncEntityTags } from "@/lib/tags";

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
      check_number?: string;
      notes?: string;
      account_id?: string | null;
      tag_ids?: unknown;
    };

    const paymentId = typeof body.id === "string" ? body.id.trim() : "";
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const paymentDate = typeof body.payment_date === "string" ? body.payment_date : null;
    const dueDate = typeof body.due_date === "string" ? body.due_date : null;
    const paymentMethod =
      typeof body.payment_method === "string" ? body.payment_method.trim() : "";
    const referenceNumber =
      typeof body.reference_number === "string" ? body.reference_number.trim() : null;
    const checkNumberInput =
      typeof body.check_number === "string" ? body.check_number.trim() || null : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const amountNumber = toNumber(body.amount_total);
    const requiresSplit = body.requires_split === true;

    if (!paymentId) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
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
    const { supabase, user, profile } = access.value;

    const { data: existingPayment, error: existingPaymentError } = await supabase
      .from("payments")
      .select("id,project_id,order_id,property_id,business_domain,payment_status,vat_rate")
      .eq("id", paymentId)
      .maybeSingle();

    if (existingPaymentError) {
      return NextResponse.json({ error: toHebrewError(existingPaymentError.message) }, { status: 400 });
    }
    if (!existingPayment?.id) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }
    if (projectId) {
      if (existingPayment.project_id !== projectId) {
        return NextResponse.json({ error: "Payment not found for project" }, { status: 404 });
      }
    } else if (existingPayment.project_id || existingPayment.order_id) {
      // No project_id supplied → only standalone income (no project/order link)
      // may be edited this way. Linked payments must go through their own flow.
      return NextResponse.json(
        { error: "תשלום משויך לפרויקט/הזמנה — יש לערוך אותו מהמסך המתאים." },
        { status: 400 }
      );
    }

    const businessDomain = isExpenseBusinessDomain(body.business_domain)
      ? body.business_domain
      : mapProjectTypeToExpenseDomain(null);

    // Keep the payment's original frozen rate when it was already official;
    // when newly marking it official, use the current rate.
    let vatRate: number | undefined;
    if (requiresSplit) {
      const existingRate =
        typeof existingPayment.vat_rate === "number"
          ? existingPayment.vat_rate
          : Number(existingPayment.vat_rate);
      vatRate =
        Number.isFinite(existingRate) && existingRate > 0
          ? existingRate
          : await getCurrentVatRate(supabase);
    }

    const { recorded_by: ignoredRecordedBy, ...paymentValues } = buildPaymentInsert({
      amountTotal: amountNumber,
      businessDomain: isExpenseBusinessDomain(existingPayment.business_domain)
        ? existingPayment.business_domain
        : businessDomain,
      paymentDate,
      paymentMethod,
      // Preserve the existing collection status — otherwise every edit (e.g.
      // fixing a check number) silently reverts a cleared check to pending.
      paymentStatus:
        existingPayment.payment_status === "pending" ||
        existingPayment.payment_status === "cleared" ||
        existingPayment.payment_status === "rejected"
          ? existingPayment.payment_status
          : undefined,
      projectId: existingPayment.project_id ?? undefined,
      orderId: existingPayment.order_id,
      propertyId: existingPayment.property_id,
      referenceNumber,
      checkNumber: paymentMethod === "check" ? checkNumberInput : null,
      notes,
      dueDate,
      requiresSplit,
      vatRate,
      recordedBy: user.id,
      accountId: typeof body.account_id === "string" && body.account_id.trim() ? body.account_id.trim() : null,
    });
    void ignoredRecordedBy;

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .update(paymentValues)
      .eq("id", paymentId)
      .select(PAYMENT_SELECT)
      .maybeSingle();

    if (paymentError) return NextResponse.json({ error: toHebrewError(paymentError.message) }, { status: 400 });
    if (payment?.id) {
      await logAuditEvent({
        supabase,
        tableName: "payments",
        recordId: payment.id,
        action: "update",
        changedBy: profile.id,
        userRole: profile.role,
      });
      await syncEntityTags(supabase, "payment", payment.id, parseTagIds(body.tag_ids), {
        replace: true,
        createdBy: profile.id,
      });
    }

    return NextResponse.json({ payment });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
