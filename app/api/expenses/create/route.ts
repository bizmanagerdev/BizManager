import { toHebrewError } from "@/lib/error-messages";
import { undoExpenseCreate } from "@/lib/documents/undoCreate";
import { NextResponse } from "next/server";
import { logAuditEventAfterResponse } from "@/lib/audit-after";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { mapProjectTypeToExpenseDomain } from "@/lib/expenses";
import { parseTagIds, syncEntityTags } from "@/lib/tags";
import { currencyPricing, type MoneyCurrencyBody } from "@/lib/fx/money-input";
import { MONEY_CURRENCY_COLUMNS } from "@/lib/fx/currencies";
import { expenseDomainFrom, expenseFieldsFrom, expenseRowFrom, type ExpenseBody } from "@/lib/expenses/expense-input";
import { clientRowId } from "@/lib/client-row-id";

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    return await withIdempotency(req, supabase, user.id, "expenses/create", async () => {
    const body = (await req.json()) as ExpenseBody & MoneyCurrencyBody;
    // Read and checked the same way the phone does (lib/expenses/expense-input.ts).
    const fields = expenseFieldsFrom(body);
    if ("error" in fields) return NextResponse.json({ error: fields.error }, { status: 400 });
    const { projectId, orderId, propertyId } = fields;
    // An expense saved on the phone first comes with the app's own id (lib/powersync/local-writes.ts).
    const clientId = clientRowId(body.id);

    let businessDomain = fields.businessDomain;

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
        .rpc("property_directory")
        .eq("id", propertyId)
        .maybeSingle();

      if (propertyError) {
        return NextResponse.json({ error: toHebrewError(propertyError.message) }, { status: 400 });
      }
      if (!(property as { id?: string } | null)?.id) {
        return NextResponse.json({ error: "הנכס שנבחר לא קיים." }, { status: 400 });
      }
    }

    const domain = expenseDomainFrom(businessDomain, fields);
    if ("error" in domain) return NextResponse.json({ error: domain.error }, { status: 400 });

    // In US$ or C$: the amounts as typed, in shekels at the day's rate (or the
    // rate typed) — amount and paid_amount are the shekels.
    const pricing = await currencyPricing(supabase, body, { amount: fields.amount, date: fields.expenseDate });
    if ("error" in pricing) return NextResponse.json({ error: pricing.error }, { status: 400 });

    const baseExpensePayload = {
      ...(clientId ? { id: clientId } : {}),
      ...expenseRowFrom(fields, { businessDomain: domain.domain, recordedBy: profile.id, pricing }),
    };
    const selectExpense =
      `id,expense_date,amount,category,description,business_domain,project_id,order_id,property_id,notes,recorded_by,payment_status,paid_amount,payment_method,account_id,created_at,updated_at,${MONEY_CURRENCY_COLUMNS}`;

    const { data: expenseData, error: expenseInsertError } = await supabase
      .from("expenses")
      .insert(baseExpensePayload)
      .select(selectExpense)
      .maybeSingle();

    if (expenseInsertError && clientId && expenseInsertError.code === "23505") {
      // Sent again after its answer was lost: the expense it already made (its
      // project link, history line and tags were done the first time).
      const { data: existing } = await supabase.from("expenses").select(selectExpense).eq("id", clientId).maybeSingle();
      if (existing) {
        const { data: link } = projectId
          ? await supabase
              .from("project_expenses")
              .select("id,project_id,expense_id,included_in_base_price,billed_to_customer,notes")
              .eq("expense_id", clientId)
              .maybeSingle()
          : { data: null };
        return NextResponse.json({ expense: existing, projectExpense: link ?? null });
      }
    }

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
          included_in_base_price: fields.includedInBasePrice,
          billed_to_customer: fields.billedToCustomer,
          notes: fields.projectExpenseNotes,
        })
        .select("id,project_id,expense_id,included_in_base_price,billed_to_customer,notes")
        .maybeSingle();

      if (linkError) {
        await undoExpenseCreate(supabase, createdExpenseId, profile.id);
        return NextResponse.json({ error: toHebrewError(linkError.message) }, { status: 400 });
      }

      projectExpense = (link as Record<string, unknown> | null) ?? null;
    }

    logAuditEventAfterResponse({
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
