import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { buildPaymentInsert } from "@/lib/payments";
import { isExpenseBusinessDomain, type ExpenseBusinessDomain } from "@/lib/expenses";

// Records statement row(s) as income: creates ONE payment (תקבול) and links every passed row
// to it via card_statement_rows.income_payment_id. Used when a card charge is really someone's
// payment for a job — e.g. the "whole card is income from somebody" action passes all the
// card's row ids and the card total. Independent of the expense side. Record-only: unlike
// /api/payments/create it does NOT auto-issue a Morning receipt. Admin/office.
type Payload = {
  row_ids?: string[];
  business_domain?: string;
  project_id?: string | null;
  order_id?: string | null;
  property_id?: string | null;
  amount_total?: number | string;
  payment_date?: string | null;
  due_date?: string | null;
  payment_method?: string;
  reference_number?: string | null;
  notes?: string | null;
  account_id?: string | null;
};

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return NaN;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    const rowIds = (Array.isArray(body.row_ids) ? body.row_ids : [])
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim());
    if (rowIds.length === 0) return NextResponse.json({ error: "לא נבחרו שורות להכנסה." }, { status: 400 });

    const businessDomain = isExpenseBusinessDomain(body.business_domain)
      ? (body.business_domain as ExpenseBusinessDomain)
      : null;
    if (!businessDomain) return NextResponse.json({ error: "יש לבחור תחום עסקי." }, { status: 400 });

    const amount = toNumber(body.amount_total);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "יש להזין סכום תקין (גדול מ-0)." }, { status: 400 });
    }
    const paymentDate = typeof body.payment_date === "string" && body.payment_date.trim() ? body.payment_date.trim() : "";
    if (!paymentDate) return NextResponse.json({ error: "יש לבחור תאריך." }, { status: 400 });
    const paymentMethod = typeof body.payment_method === "string" ? body.payment_method.trim() : "";
    if (!paymentMethod) return NextResponse.json({ error: "יש לבחור אמצעי תשלום." }, { status: 400 });

    const projectId =
      businessDomain === "logistics_projects" && typeof body.project_id === "string" && body.project_id.trim()
        ? body.project_id.trim()
        : null;
    const orderId =
      businessDomain === "sales" && typeof body.order_id === "string" && body.order_id.trim()
        ? body.order_id.trim()
        : null;
    const propertyId =
      businessDomain === "property_management" && typeof body.property_id === "string" && body.property_id.trim()
        ? body.property_id.trim()
        : null;

    const dueDate = typeof body.due_date === "string" && body.due_date.trim() ? body.due_date.trim() : null;
    const referenceNumber =
      typeof body.reference_number === "string" && body.reference_number.trim() ? body.reference_number.trim() : null;
    const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
    const accountId =
      typeof body.account_id === "string" && body.account_id.trim() ? body.account_id.trim() : null;

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .insert(
        buildPaymentInsert({
          amountTotal: amount,
          businessDomain,
          accountId,
          paymentDate,
          paymentMethod,
          projectId,
          orderId,
          propertyId,
          referenceNumber,
          notes,
          dueDate,
          recordedBy: user.id,
        })
      )
      .select("id")
      .maybeSingle();
    if (paymentError || !payment?.id) {
      return NextResponse.json({ error: paymentError?.message ?? "יצירת ההכנסה נכשלה." }, { status: 400 });
    }
    const paymentId = payment.id as string;

    const { error: linkError } = await supabase
      .from("card_statement_rows")
      .update({ income_payment_id: paymentId })
      .in("id", rowIds);
    if (linkError) {
      // Payment exists but the link failed — surface it; the payment can still be seen in financial.
      return NextResponse.json({ error: `ההכנסה נוצרה אך הקישור לשורות נכשל: ${linkError.message}`, payment_id: paymentId }, { status: 400 });
    }

    await logAuditEvent({
      supabase,
      tableName: "payments",
      recordId: paymentId,
      action: "create",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ payment_id: paymentId, linked: rowIds.length });
  } catch (err: unknown) {
    const message = toHebrewError(err, "יצירת ההכנסה נכשלה.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
