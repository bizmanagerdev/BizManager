import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Lightweight confirmation that an expense was actually paid. Unlike
// /api/expenses/update (which rewrites the whole row), this only flips
// payment_status → 'paid' and records the method + the real pay date, so the
// "סמן כשולם" quick action doesn't need amount/category/etc. The expense then
// counts as real cash out on its paid_date (see lib/financial buildExpenseFlowMeta).

const PAYMENT_METHODS = new Set(["bank_transfer", "cash", "check", "credit_card", "other"]);

function isMissingColumn(error: { code?: string; message?: string } | null, column: string) {
  if (!error) return false;
  return (
    error.code === "42703" &&
    typeof error.message === "string" &&
    error.message.toLowerCase().includes(column.toLowerCase())
  );
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      id?: string;
      payment_method?: string | null;
      paid_date?: string | null;
    };

    const expenseId = typeof body.id === "string" ? body.id.trim() : "";
    if (!expenseId) {
      return NextResponse.json({ error: "חסר מזהה הוצאה." }, { status: 400 });
    }

    const rawMethod = typeof body.payment_method === "string" ? body.payment_method.trim() : "";
    const paymentMethod = rawMethod && PAYMENT_METHODS.has(rawMethod) ? rawMethod : null;

    const rawPaidDate = typeof body.paid_date === "string" ? body.paid_date.trim() : "";
    const paidDate = /^\d{4}-\d{2}-\d{2}$/.test(rawPaidDate)
      ? rawPaidDate
      : new Date().toISOString().slice(0, 10);

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const selectExpense =
      "id,expense_date,amount,category,description,business_domain,project_id,order_id,property_id,notes,recorded_by,payment_status,paid_amount,payment_method,paid_date,created_at,updated_at";

    // Try with paid_date; fall back if the column hasn't been added yet.
    let expense: Record<string, unknown> | null = null;
    let updateError: { code?: string; message?: string } | null = null;

    {
      const { data, error } = await supabase
        .from("expenses")
        .update({ payment_status: "paid", payment_method: paymentMethod, paid_date: paidDate })
        .eq("id", expenseId)
        .select(selectExpense)
        .maybeSingle();
      expense = (data as Record<string, unknown> | null) ?? null;
      updateError = error ? { code: error.code, message: error.message } : null;
    }

    if (updateError && isMissingColumn(updateError, "paid_date")) {
      const { data, error } = await supabase
        .from("expenses")
        .update({ payment_status: "paid", payment_method: paymentMethod })
        .eq("id", expenseId)
        .select(
          "id,expense_date,amount,category,description,business_domain,project_id,order_id,property_id,notes,recorded_by,payment_status,paid_amount,payment_method,created_at,updated_at"
        )
        .maybeSingle();
      expense = (data as Record<string, unknown> | null) ?? null;
      updateError = error ? { code: error.code, message: error.message } : null;
    }

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }
    if (!expense?.id) {
      return NextResponse.json({ error: "ההוצאה לא נמצאה." }, { status: 404 });
    }

    await logAuditEvent({
      supabase,
      tableName: "expenses",
      recordId: expense.id as string,
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ expense });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא צפויה בעת סימון ההוצאה כשולמה.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
