import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { isExpenseBusinessDomain, mapProjectTypeToExpenseDomain } from "@/lib/expenses";
import { parseTagIds, syncEntityTags } from "@/lib/tags";


export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    return await withIdempotency(req, supabase, user.id, "expenses/create", async () => {
    const body = (await req.json()) as {
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
      bill_to_customer_amount?: number | string | null;
      project_expense_notes?: string;
      payment_status?: string | null;
      paid_amount?: number | string | null;
      payment_method?: string | null;
      account_id?: string | null;
      tag_ids?: unknown;
    };

    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
    const propertyId = typeof body.property_id === "string" ? body.property_id.trim() : "";
    const businessDomainInput =
      typeof body.business_domain === "string" ? body.business_domain.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const includedInBasePrice = Boolean(body.included_in_base_price);
    const billedToCustomer = Boolean(body.billed_to_customer);
    const projectExpenseNotes =
      typeof body.project_expense_notes === "string" ? body.project_expense_notes.trim() : null;

    const amountNumber =
      typeof body.amount === "number" ? body.amount : typeof body.amount === "string" ? Number(body.amount) : NaN;

    if (!category || !Number.isFinite(amountNumber)) {
      return NextResponse.json({ error: "יש להזין קטגוריה וסכום." }, { status: 400 });
    }

    const expenseDate = typeof body.expense_date === "string" ? body.expense_date : null;
    if (!expenseDate) {
      return NextResponse.json({ error: "יש להזין תאריך להוצאה." }, { status: 400 });
    }

    const selectedLinks = [projectId, orderId, propertyId].filter(Boolean);
    if (selectedLinks.length > 1) {
      return NextResponse.json(
        { error: "ניתן לשייך הוצאה למקור אחד בלבד (פרויקט / הזמנה / נכס)." },
        { status: 400 }
      );
    }

    let businessDomain = businessDomainInput;

    if (projectId) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id,project_type")
        .eq("id", projectId)
        .maybeSingle();

      if (projectError) {
        return NextResponse.json({ error: toHebrewError(projectError.message) }, { status: 400 });
      }
      if (!project?.id) {
        return NextResponse.json({ error: "הפרויקט שנבחר לא קיים." }, { status: 400 });
      }

      if (!businessDomain) {
        businessDomain = mapProjectTypeToExpenseDomain(
          typeof project.project_type === "string" ? project.project_type : null
        );
      }
    }

    if (orderId) {
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("id")
        .eq("id", orderId)
        .maybeSingle();

      if (orderError) {
        return NextResponse.json({ error: toHebrewError(orderError.message) }, { status: 400 });
      }
      if (!order?.id) {
        return NextResponse.json({ error: "ההזמנה שנבחרה לא קיימת." }, { status: 400 });
      }
    }

    if (propertyId) {
      const { data: property, error: propertyError } = await supabase
        .from("properties")
        .select("id")
        .eq("id", propertyId)
        .maybeSingle();

      if (propertyError) {
        return NextResponse.json({ error: toHebrewError(propertyError.message) }, { status: 400 });
      }
      if (!property?.id) {
        return NextResponse.json({ error: "הנכס שנבחר לא קיים." }, { status: 400 });
      }
    }

    if (!isExpenseBusinessDomain(businessDomain)) {
      return NextResponse.json({ error: "יש לבחור תחום עסקי." }, { status: 400 });
    }
    if (businessDomain === "property_management" && !propertyId) {
      return NextResponse.json({ error: "יש לבחור נכס לתחום ניהול נכסים." }, { status: 400 });
    }
    if (businessDomain === "logistics_projects" && !projectId) {
      return NextResponse.json({ error: "יש לבחור פרויקט לתחום פרויקטים." }, { status: 400 });
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
    const accountId = typeof body.account_id === "string" && body.account_id.trim()
      ? body.account_id.trim()
      : null;

    const baseExpensePayload = {
      expense_date: expenseDate,
      amount: amountNumber,
      category,
      description,
      business_domain: businessDomain,
      project_id: projectId || null,
      order_id: orderId || null,
      property_id: propertyId || null,
      notes,
      recorded_by: user.id,
      payment_status: paymentStatus,
      paid_amount: paidAmount,
      payment_method: (paymentStatus === "paid" || paymentStatus === "partial") ? paymentMethod : null,
      account_id: accountId,
    };
    const selectExpense =
      "id,expense_date,amount,category,description,business_domain,project_id,order_id,property_id,notes,recorded_by,payment_status,paid_amount,payment_method,account_id,created_at,updated_at";

    const { data: expenseData, error: expenseInsertError } = await supabase
      .from("expenses")
      .insert(baseExpensePayload)
      .select(selectExpense)
      .maybeSingle();

    const expense: Record<string, unknown> | null = expenseData as Record<string, unknown> | null;
    const expenseError = expenseInsertError ? { message: expenseInsertError.message } : null;

    const createdExpenseId = typeof expense?.id === "string" ? expense.id : null;

    if (expenseError) return NextResponse.json({ error: toHebrewError(expenseError.message) }, { status: 400 });
    if (!createdExpenseId) return NextResponse.json({ error: "יצירת ההוצאה נכשלה." }, { status: 500 });

    let projectExpense: Record<string, unknown> | null = null;

    if (projectId) {
      const { data: link, error: linkError } = await supabase
        .from("project_expenses")
        .insert({
          project_id: projectId,
          expense_id: createdExpenseId,
          included_in_base_price: includedInBasePrice,
          billed_to_customer: billedToCustomer,
          notes: projectExpenseNotes,
        })
        .select("id,project_id,expense_id,included_in_base_price,billed_to_customer,notes")
        .maybeSingle();

      if (linkError) {
        await supabase.from("expenses").delete().eq("id", createdExpenseId);
        return NextResponse.json({ error: toHebrewError(linkError.message) }, { status: 400 });
      }

      projectExpense = (link as Record<string, unknown> | null) ?? null;
    }

    await logAuditEvent({
      supabase,
      tableName: "expenses",
      recordId: createdExpenseId,
      action: "create",
      changedBy: profile.id,
      userRole: profile.role,
    });

    await syncEntityTags(supabase, "expense", createdExpenseId, parseTagIds(body.tag_ids), {
      createdBy: profile.id,
    });

    return NextResponse.json({ expense, projectExpense });
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "שגיאה לא צפויה בעת יצירת ההוצאה.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
