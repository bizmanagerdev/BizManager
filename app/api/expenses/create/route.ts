import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isExpenseBusinessDomain, mapProjectTypeToExpenseDomain } from "@/lib/expenses";

function isMissingColumnError(error: unknown, columnName: string) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  const message = "message" in error ? (error as { message?: unknown }).message : undefined;
  return (
    code === "42703" &&
    typeof message === "string" &&
    message.toLowerCase().includes(columnName.toLowerCase())
  );
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      project_id?: string | null;
      order_id?: string | null;
      property_id?: string | null;
      business_domain?: string;
      amount?: number | string;
      payment_method?: string;
      category?: string;
      description?: string;
      notes?: string;
      expense_date?: string | null;
      included_in_base_price?: boolean;
      billed_to_customer?: boolean;
      project_expense_notes?: string;
    };

    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
    const propertyId = typeof body.property_id === "string" ? body.property_id.trim() : "";
    const businessDomainInput =
      typeof body.business_domain === "string" ? body.business_domain.trim() : "";
    const paymentMethod = typeof body.payment_method === "string" ? body.payment_method.trim() : null;
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
      return NextResponse.json({ error: "Missing category or amount" }, { status: 400 });
    }

    const expenseDate = typeof body.expense_date === "string" ? body.expense_date : null;
    if (!expenseDate) {
      return NextResponse.json({ error: "Missing expense_date" }, { status: 400 });
    }

    const selectedLinks = [projectId, orderId, propertyId].filter(Boolean);
    if (selectedLinks.length > 1) {
      return NextResponse.json(
        { error: "Only one of project_id, order_id, or property_id can be provided" },
        { status: 400 }
      );
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    let businessDomain = businessDomainInput;

    if (projectId) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id,project_type")
        .eq("id", projectId)
        .maybeSingle();

      if (projectError) {
        return NextResponse.json({ error: projectError.message }, { status: 400 });
      }
      if (!project?.id) {
        return NextResponse.json({ error: "Invalid project_id" }, { status: 400 });
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
        return NextResponse.json({ error: orderError.message }, { status: 400 });
      }
      if (!order?.id) {
        return NextResponse.json({ error: "Invalid order_id" }, { status: 400 });
      }
    }

    if (propertyId) {
      const { data: property, error: propertyError } = await supabase
        .from("properties")
        .select("id")
        .eq("id", propertyId)
        .maybeSingle();

      if (propertyError) {
        return NextResponse.json({ error: propertyError.message }, { status: 400 });
      }
      if (!property?.id) {
        return NextResponse.json({ error: "Invalid property_id" }, { status: 400 });
      }
    }

    if (!isExpenseBusinessDomain(businessDomain)) {
      return NextResponse.json({ error: "Missing or invalid business_domain" }, { status: 400 });
    }

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
    };
    const selectWithPaymentMethod =
      "id,expense_date,amount,payment_method,category,description,business_domain,project_id,order_id,property_id,notes,recorded_by,created_at,updated_at";
    const selectWithoutPaymentMethod =
      "id,expense_date,amount,category,description,business_domain,project_id,order_id,property_id,notes,recorded_by,created_at,updated_at";

    let expense: Record<string, unknown> | null = null;
    let expenseError: { message: string } | null = null;

    const primaryResult = await supabase
      .from("expenses")
      .insert({
        ...baseExpensePayload,
        payment_method: paymentMethod || null,
      })
      .select(selectWithPaymentMethod)
      .maybeSingle();

    if (primaryResult.error && isMissingColumnError(primaryResult.error, "payment_method")) {
      if (paymentMethod) {
        return NextResponse.json(
          { error: "Expense payment method requires running db/sql/add_payment_method_to_expenses.sql" },
          { status: 400 }
        );
      }

      const fallbackResult = await supabase
        .from("expenses")
        .insert(baseExpensePayload)
        .select(selectWithoutPaymentMethod)
        .maybeSingle();

      expense = fallbackResult.data
        ? ({ ...fallbackResult.data, payment_method: null } as Record<string, unknown>)
        : null;
      expenseError = fallbackResult.error ? { message: fallbackResult.error.message } : null;
    } else {
      expense = (primaryResult.data as Record<string, unknown> | null) ?? null;
      expenseError = primaryResult.error ? { message: primaryResult.error.message } : null;
    }

    const createdExpenseId = typeof expense?.id === "string" ? expense.id : null;

    if (expenseError) return NextResponse.json({ error: expenseError.message }, { status: 400 });
    if (!createdExpenseId) return NextResponse.json({ error: "Failed to create expense" }, { status: 500 });

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
        return NextResponse.json({ error: linkError.message }, { status: 400 });
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

    return NextResponse.json({ expense, projectExpense });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
