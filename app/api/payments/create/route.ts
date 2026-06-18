import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { tryAutoIssueReceiptForPayment } from "@/lib/morning/service";
import { buildPaymentInsert, PAYMENT_SELECT } from "@/lib/payments";
import { getCurrentVatRate } from "@/lib/settings/vat";
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
  due_date?: string | null;
  amount_total?: number | string;
  requires_split?: boolean;
  payment_method?: string;
  reference_number?: string;
  check_number?: string;
  notes?: string;
};

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return NaN;
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    return await withIdempotency(req, supabase, user.id, "payments/create", async () => {
    const body = (await req.json()) as CreatePaymentPayload;
    const paymentDate = typeof body.payment_date === "string" ? body.payment_date : null;
    const dueDate = typeof body.due_date === "string" ? body.due_date : null;
    const paymentMethod =
      typeof body.payment_method === "string" ? body.payment_method.trim() : "";
    const referenceNumber =
      typeof body.reference_number === "string" ? body.reference_number.trim() : null;
    const checkNumberInput =
      typeof body.check_number === "string" ? body.check_number.trim() || null : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
    const propertyId = typeof body.property_id === "string" ? body.property_id.trim() : "";
    const amountNumber = toNumber(body.amount_total);
    const requiresSplit = body.requires_split === true;

    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      return NextResponse.json({ error: "Missing or invalid amount_total" }, { status: 400 });
    }
    if (!paymentDate || !paymentMethod) {
      return NextResponse.json({ error: "Missing payment_date or payment_method" }, { status: 400 });
    }
    if (paymentMethod === "check" && !dueDate) {
      return NextResponse.json({ error: "Missing due_date for check payment" }, { status: 400 });
    }

    const linkedIds = [projectId, orderId, propertyId].filter(Boolean);
    if (linkedIds.length > 1) {
      return NextResponse.json(
        { error: "Only one of project_id, order_id, or property_id can be provided" },
        { status: 400 }
      );
    }

    let businessDomain: ExpenseBusinessDomain | null = isExpenseBusinessDomain(body.business_domain)
      ? body.business_domain
      : null;

    if (projectId) {
      const { data: project, error } = await supabase
        .from("projects")
        .select("id,project_type")
        .eq("id", projectId)
        .maybeSingle();

      if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
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

      if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
      if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

      if (!businessDomain) businessDomain = "sales";
    }

    if (propertyId) {
      const { data: property, error } = await supabase
        .from("properties")
        .select("id")
        .eq("id", propertyId)
        .maybeSingle();

      if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
      if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

      if (!businessDomain) businessDomain = "property_management";
    }

    if (!businessDomain) {
      return NextResponse.json({ error: "Missing or invalid business_domain" }, { status: 400 });
    }

    // Freeze the current VAT rate onto official payments so later rate changes
    // never alter this row's net/VAT split.
    const vatRate = requiresSplit ? await getCurrentVatRate(supabase) : undefined;

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
          checkNumber: paymentMethod === "check" ? checkNumberInput : null,
          notes,
          dueDate,
          requiresSplit,
          vatRate,
          recordedBy: user.id,
        })
      )
      .select(PAYMENT_SELECT)
      .maybeSingle();

    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    let morningAutoReceipt: {
      skipped: boolean;
      reason: string | null;
      morning_document_id: string | null;
    } | null = null;
    if (data?.id) {
      await logAuditEvent({
        supabase,
        tableName: "payments",
        recordId: data.id,
        action: "create",
        changedBy: profile.id,
        userRole: profile.role,
      });

      const outcome = await tryAutoIssueReceiptForPayment(supabase, {
        paymentId: data.id,
        actor: { profileId: profile.id, authUserId: user.id, role: profile.role },
      });
      morningAutoReceipt = {
        skipped: outcome.skipped,
        reason: outcome.ok ? outcome.reason : outcome.reason,
        morning_document_id: outcome.morningDocumentId,
      };
    }

    return NextResponse.json({ payment: data, morning_auto_receipt: morningAutoReceipt });
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
