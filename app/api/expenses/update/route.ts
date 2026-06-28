import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import { parseTagIds, syncEntityTags } from "@/lib/tags";


export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: string;
      project_id?: string | null;
      order_id?: string | null;
      property_id?: string | null;
      business_domain?: string;
      amount?: number | string;
      category?: string;
      description?: string;
      notes?: string;
      expense_date?: string | null;
      included_in_base_price?: boolean;
      billed_to_customer?: boolean;
      project_expense_notes?: string;
      payment_status?: string | null;
      paid_amount?: number | string | null;
      payment_method?: string | null;
      tag_ids?: unknown;
    };

    const expenseId = typeof body.id === "string" ? body.id.trim() : "";
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
    const propertyId = typeof body.property_id === "string" ? body.property_id.trim() : "";
    const businessDomainInput =
      typeof body.business_domain === "string" ? body.business_domain.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const projectExpenseNotes =
      typeof body.project_expense_notes === "string" ? body.project_expense_notes.trim() : null;
    const amountNumber =
      typeof body.amount === "number" ? body.amount : typeof body.amount === "string" ? Number(body.amount) : NaN;
    const expenseDate = typeof body.expense_date === "string" ? body.expense_date : null;

    if (!expenseId) {
      return NextResponse.json({ error: "חסר מזהה הוצאה." }, { status: 400 });
    }
    if (!category || !Number.isFinite(amountNumber) || amountNumber <= 0) {
      return NextResponse.json({ error: "יש להזין קטגוריה וסכום תקין." }, { status: 400 });
    }
    if (!expenseDate) {
      return NextResponse.json({ error: "יש להזין תאריך להוצאה." }, { status: 400 });
    }
    if ([projectId, orderId, propertyId].filter(Boolean).length > 1) {
      return NextResponse.json(
        { error: "ניתן לשייך הוצאה למקור אחד בלבד (פרויקט / הזמנה / נכס)." },
        { status: 400 }
      );
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const [{ data: expenseRow, error: expenseReadError }, { data: projectExpenseRow, error: projectExpenseReadError }] =
      await Promise.all([
        supabase
          .from("expenses")
          .select("id,project_id,order_id,property_id,business_domain")
          .eq("id", expenseId)
          .maybeSingle(),
        supabase
          .from("project_expenses")
          .select("project_id")
          .eq("expense_id", expenseId)
          .maybeSingle(),
      ]);

    if (expenseReadError) return NextResponse.json({ error: toHebrewError(expenseReadError.message) }, { status: 400 });
    if (projectExpenseReadError) {
      return NextResponse.json({ error: toHebrewError(projectExpenseReadError.message) }, { status: 400 });
    }
    if (!expenseRow?.id) return NextResponse.json({ error: "ההוצאה לא נמצאה." }, { status: 404 });

    const effectiveProjectId = expenseRow.project_id || projectExpenseRow?.project_id || "";
    const effectiveOrderId = expenseRow.order_id || "";
    const effectivePropertyId = expenseRow.property_id || "";

    if (effectiveProjectId && projectId !== effectiveProjectId) {
      return NextResponse.json({ error: "ההוצאה לא משויכת לפרויקט שנבחר." }, { status: 404 });
    }
    if (effectiveOrderId && orderId !== effectiveOrderId) {
      return NextResponse.json({ error: "ההוצאה לא משויכת להזמנה שנבחרה." }, { status: 404 });
    }
    if (effectivePropertyId && propertyId !== effectivePropertyId) {
      return NextResponse.json({ error: "ההוצאה לא משויכת לנכס שנבחר." }, { status: 404 });
    }
    if (!effectiveProjectId && projectId) {
      return NextResponse.json({ error: "ההוצאה לא משויכת לפרויקט שנבחר." }, { status: 404 });
    }
    if (!effectiveOrderId && orderId) {
      return NextResponse.json({ error: "ההוצאה לא משויכת להזמנה שנבחרה." }, { status: 404 });
    }
    if (!effectivePropertyId && propertyId) {
      return NextResponse.json({ error: "ההוצאה לא משויכת לנכס שנבחר." }, { status: 404 });
    }

    const lockedBusinessDomain = effectiveProjectId
      ? "logistics_projects"
      : effectiveOrderId
        ? "sales"
        : effectivePropertyId
          ? "property_management"
          : null;
    const nextBusinessDomain =
      businessDomainInput ||
      (typeof expenseRow.business_domain === "string" ? expenseRow.business_domain.trim() : "") ||
      lockedBusinessDomain ||
      "general_business";

    if (lockedBusinessDomain && nextBusinessDomain !== lockedBusinessDomain) {
      return NextResponse.json({ error: "תחום עסקי לא תואם להוצאה המקושרת." }, { status: 400 });
    }
    if (!isExpenseBusinessDomain(nextBusinessDomain)) {
      return NextResponse.json({ error: "יש לבחור תחום עסקי." }, { status: 400 });
    }

    const rawPaymentStatus = typeof body.payment_status === "string" ? body.payment_status.trim() : null;
    const paymentStatus = rawPaymentStatus === "paid" || rawPaymentStatus === "partial" || rawPaymentStatus === "not_paid"
      ? rawPaymentStatus
      : null;
    const rawPaidAmount = body.paid_amount != null ? Number(body.paid_amount) : null;
    const paidAmount = paymentStatus === "partial" && rawPaidAmount != null && Number.isFinite(rawPaidAmount) && rawPaidAmount > 0
      ? rawPaidAmount
      : null;
    const paymentMethod = typeof body.payment_method === "string" && body.payment_method.trim()
      ? body.payment_method.trim()
      : null;

    const baseExpensePayload = {
      amount: amountNumber,
      category,
      description,
      notes,
      expense_date: expenseDate,
      business_domain: nextBusinessDomain,
      payment_status: paymentStatus,
      paid_amount: paidAmount,
      payment_method: (paymentStatus === "paid" || paymentStatus === "partial") ? paymentMethod : null,
    };
    const selectExpense =
      "id,expense_date,amount,category,description,business_domain,project_id,order_id,property_id,notes,recorded_by,payment_status,paid_amount,payment_method,created_at,updated_at";

    const { data: expenseData, error: expenseUpdateError } = await supabase
      .from("expenses")
      .update(baseExpensePayload)
      .eq("id", expenseId)
      .select(selectExpense)
      .maybeSingle();

    const expense: Record<string, unknown> | null = expenseData as Record<string, unknown> | null;
    const expenseError = expenseUpdateError ? { message: expenseUpdateError.message } : null;

    const updatedExpenseId = typeof expense?.id === "string" ? expense.id : null;

    if (expenseError) return NextResponse.json({ error: toHebrewError(expenseError.message) }, { status: 400 });

    let projectExpense: Record<string, unknown> | null = null;

    if (effectiveProjectId) {
      const { data: updatedProjectExpense, error: projectExpenseError } = await supabase
        .from("project_expenses")
        .update({
          included_in_base_price: Boolean(body.included_in_base_price),
          billed_to_customer: Boolean(body.billed_to_customer),
          notes: projectExpenseNotes,
        })
        .eq("project_id", effectiveProjectId)
        .eq("expense_id", expenseId)
        .select("id,project_id,expense_id,included_in_base_price,billed_to_customer,notes")
        .maybeSingle();

      if (projectExpenseError) {
        return NextResponse.json({ error: toHebrewError(projectExpenseError.message) }, { status: 400 });
      }

      projectExpense = (updatedProjectExpense as Record<string, unknown> | null) ?? null;
    }

    if (updatedExpenseId) {
      await logAuditEvent({
        supabase,
        tableName: "expenses",
        recordId: updatedExpenseId,
        action: "update",
        changedBy: profile.id,
        userRole: profile.role,
      });
      await syncEntityTags(supabase, "expense", updatedExpenseId, parseTagIds(body.tag_ids), {
        replace: true,
        createdBy: profile.id,
      });
    }

    return NextResponse.json({ expense, projectExpense });
  } catch (err: unknown) {
    const message = toHebrewError(err, "שגיאה לא צפויה בעת עדכון ההוצאה.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
