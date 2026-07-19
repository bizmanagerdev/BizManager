import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Mark an UPCOMING recurring occurrence (a calendar forecast that has no expense
// row yet) as paid. It materializes the concrete expense for that period from the
// template and stamps it paid in one step. Idempotent per (template, recurrence_key):
// if the generator already created the row, we just flip it to paid.

const PAYMENT_METHODS = new Set(["bank_transfer", "cash", "check", "credit_card", "other"]);

function applyTokens(value: string | null, periodKey: string, expenseDate: string): string | null {
  if (!value) return null;
  return value
    .split("{{period_key}}").join(periodKey)
    .split("{{expense_date}}").join(expenseDate)
    .split("{{expense_month}}").join(expenseDate.slice(0, 7));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      template_id?: string;
      recurrence_key?: string;
      expense_date?: string;
      amount?: number | string | null;
      payment_method?: string | null;
      account_id?: string | null;
      paid_date?: string | null;
    };

    const templateId = typeof body.template_id === "string" ? body.template_id.trim() : "";
    const recurrenceKey = typeof body.recurrence_key === "string" ? body.recurrence_key.trim() : "";
    const expenseDate = typeof body.expense_date === "string" ? body.expense_date.trim() : "";
    if (!templateId || !recurrenceKey || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
      return NextResponse.json({ error: "חסרים פרטי ההוצאה הקבועה." }, { status: 400 });
    }

    const rawMethod = typeof body.payment_method === "string" ? body.payment_method.trim() : "";
    const paymentMethod = rawMethod && PAYMENT_METHODS.has(rawMethod) ? rawMethod : null;
    const rawPaidDate = typeof body.paid_date === "string" ? body.paid_date.trim() : "";
    const paidDate = /^\d{4}-\d{2}-\d{2}$/.test(rawPaidDate) ? rawPaidDate : new Date().toISOString().slice(0, 10);

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    // Load the template.
    const { data: tpl, error: tplErr } = await supabase
      .from("recurring_expense_templates")
      .select("id,template_name,category,amount,is_variable_amount,description_template,notes_template,business_domain,project_id,order_id,property_id,account_id,included_in_base_price,billed_to_customer,project_expense_notes_template")
      .eq("id", templateId)
      .maybeSingle();
    if (tplErr) return NextResponse.json({ error: toHebrewError(tplErr.message) }, { status: 400 });
    if (!tpl) return NextResponse.json({ error: "ההוצאה הקבועה לא נמצאה." }, { status: 404 });

    const t = tpl as Record<string, unknown>;
    const accountId =
      (typeof body.account_id === "string" && body.account_id.trim()) ? body.account_id.trim()
      : (typeof t.account_id === "string" ? t.account_id : null);

    // Variable-amount templates carry no amount — the payer supplies it now.
    const isVariable = t.is_variable_amount === true;
    const bodyAmount = typeof body.amount === "number" ? body.amount
      : typeof body.amount === "string" ? Number(body.amount) : NaN;
    let effectiveAmount = Number(t.amount);
    if (isVariable) {
      if (!Number.isFinite(bodyAmount) || bodyAmount <= 0) {
        return NextResponse.json({ error: "יש להזין את סכום התשלום." }, { status: 400 });
      }
      effectiveAmount = bodyAmount;
    } else if (Number.isFinite(bodyAmount) && bodyAmount > 0) {
      effectiveAmount = bodyAmount;
    }

    // If the generator already created this period's row, just flip it to paid.
    const { data: existing } = await supabase
      .from("expenses")
      .select("id")
      .eq("recurring_expense_template_id", templateId)
      .eq("recurrence_key", recurrenceKey)
      .maybeSingle();

    let expenseId = (existing as { id?: string } | null)?.id ?? "";

    if (expenseId) {
      const { error } = await supabase
        .from("expenses")
        .update({ amount: effectiveAmount, payment_status: "paid", payment_method: paymentMethod, account_id: accountId, paid_date: paidDate })
        .eq("id", expenseId);
      if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    } else {
      const { data: inserted, error } = await supabase
        .from("expenses")
        .insert({
          expense_date: expenseDate,
          amount: effectiveAmount,
          category: t.category,
          description: applyTokens(t.description_template as string | null, recurrenceKey, expenseDate),
          business_domain: t.business_domain,
          project_id: t.project_id,
          order_id: t.order_id,
          property_id: t.property_id,
          account_id: accountId,
          notes: applyTokens(t.notes_template as string | null, recurrenceKey, expenseDate),
          recorded_by: profile.id,
          recurring_expense_template_id: templateId,
          recurrence_key: recurrenceKey,
          payment_status: "paid",
          payment_method: paymentMethod,
          paid_date: paidDate,
        })
        .select("id")
        .maybeSingle();
      if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
      expenseId = (inserted as { id?: string } | null)?.id ?? "";

      // Mirror the generator: link a project expense when the template targets one.
      if (expenseId && typeof t.project_id === "string" && t.project_id) {
        await supabase.from("project_expenses").insert({
          project_id: t.project_id,
          expense_id: expenseId,
          included_in_base_price: t.included_in_base_price === true,
          billed_to_customer: t.billed_to_customer === true,
          notes: applyTokens(t.project_expense_notes_template as string | null, recurrenceKey, expenseDate),
        });
      }
    }

    if (!expenseId) {
      return NextResponse.json({ error: "יצירת ההוצאה נכשלה." }, { status: 500 });
    }

    await logAuditEvent({
      supabase,
      tableName: "expenses",
      recordId: expenseId,
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ ok: true, id: expenseId });
  } catch (err: unknown) {
    const message = toHebrewError(err, "שגיאה לא צפויה בעת סימון ההוצאה הקבועה כשולמה.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
