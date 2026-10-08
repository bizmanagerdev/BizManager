import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { logAuditEventAfterResponse } from "@/lib/audit-after";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { tryAutoIssueReceiptForPayment } from "@/lib/morning/service";
import { runAfterResponse } from "@/lib/after-response";
import { PAYMENT_SELECT } from "@/lib/payments";
import { getCurrentVatRate } from "@/lib/settings/vat";
import { parseTagIds, syncEntityTags } from "@/lib/tags";
import { mapProjectTypeToExpenseDomain, type ExpenseBusinessDomain } from "@/lib/expenses";
import { paymentFieldsFrom, paymentRowFrom, type PaymentBody } from "@/lib/payments/payment-input";
import { clientRowId } from "@/lib/client-row-id";

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    return await withIdempotency(req, supabase, user.id, "payments/create", async () => {
    const body = (await req.json()) as PaymentBody;
    // Read and checked the same way the phone does (lib/payments/payment-input.ts).
    const fields = paymentFieldsFrom(body);
    if ("error" in fields) return NextResponse.json({ error: fields.error }, { status: 400 });
    const { projectId, orderId, propertyId, requiresSplit } = fields;
    // A payment saved on the phone first comes with the app's own id (lib/powersync/local-writes.ts).
    const clientId = clientRowId(body.id);

    let businessDomain: ExpenseBusinessDomain | null = fields.businessDomain;

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
      .insert({
        ...(clientId ? { id: clientId } : {}),
        ...paymentRowFrom(fields, { businessDomain, vatRate, recordedBy: user.id }),
      })
      .select(PAYMENT_SELECT)
      .maybeSingle();

    if (error && clientId && error.code === "23505") {
      // Sent again after its answer was lost: the payment it already made (its
      // history line, receipt and tags were done the first time).
      const { data: existing } = await supabase.from("payments").select(PAYMENT_SELECT).eq("id", clientId).maybeSingle();
      if (existing) return NextResponse.json({ payment: existing });
    }
    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    if (data?.id) {
      logAuditEventAfterResponse({
        supabase,
        tableName: "payments",
        recordId: data.id,
        action: "create",
        changedBy: profile.id,
        userRole: profile.role,
      });

      // Best-effort Morning auto-receipt, after the response: with auto-receipt
      // on it's an external API call (seconds) the person saving doesn't need to
      // wait for. A failure is still recorded (morning_auto_receipt_failed audit).
      const paymentId = data.id;
      const actor = { profileId: profile.id, authUserId: user.id, role: profile.role };
      runAfterResponse("payments/create Morning receipt", () =>
        tryAutoIssueReceiptForPayment(supabase, { paymentId, actor })
      );

      await syncEntityTags(supabase, "payment", data.id, parseTagIds(body.tag_ids), {
        createdBy: profile.id,
      });
    }

    return NextResponse.json({ payment: data });
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
