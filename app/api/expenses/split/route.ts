import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { isExpenseBusinessDomain } from "@/lib/expenses";

// Split one obligation into N separate dated payments. Each becomes its own
// `expenses` row (payment_status 'not_paid') sharing an `installment_group_id`,
// so it lands on its own day in the payments calendar and is marked paid
// individually. Optionally replaces an existing unpaid expense (source_expense_id)
// with its installments.

type InstallmentInput = { expense_date?: string | null; amount?: number | string | null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    return await withIdempotency(req, supabase, user.id, "expenses/split", async () => {
      const body = (await req.json().catch(() => ({}))) as {
        source_expense_id?: string | null;
        business_domain?: string;
        category?: string;
        description?: string | null;
        notes?: string | null;
        account_id?: string | null;
        project_id?: string | null;
        order_id?: string | null;
        property_id?: string | null;
        installments?: InstallmentInput[];
      };

      const businessDomain = typeof body.business_domain === "string" ? body.business_domain.trim() : "";
      const category = typeof body.category === "string" ? body.category.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() || null : null;
      const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
      const accountId = typeof body.account_id === "string" && body.account_id.trim() ? body.account_id.trim() : null;
      const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
      const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
      const propertyId = typeof body.property_id === "string" ? body.property_id.trim() : "";
      const sourceExpenseId = typeof body.source_expense_id === "string" ? body.source_expense_id.trim() : "";

      if (!category) {
        return NextResponse.json({ error: "יש להזין קטגוריה." }, { status: 400 });
      }
      if (!isExpenseBusinessDomain(businessDomain)) {
        return NextResponse.json({ error: "יש לבחור תחום עסקי." }, { status: 400 });
      }
      const selectedLinks = [projectId, orderId, propertyId].filter(Boolean);
      if (selectedLinks.length > 1) {
        return NextResponse.json(
          { error: "ניתן לשייך תשלום למקור אחד בלבד (פרויקט / הזמנה / נכס)." },
          { status: 400 }
        );
      }

      const rawInstallments = Array.isArray(body.installments) ? body.installments : [];
      const installments = rawInstallments.map((row) => ({
        date: typeof row.expense_date === "string" ? row.expense_date.trim() : "",
        amount: typeof row.amount === "number" ? row.amount : Number(row.amount),
      }));

      if (installments.length < 2) {
        return NextResponse.json({ error: "יש להזין לפחות שני תשלומים לפיצול." }, { status: 400 });
      }
      for (const row of installments) {
        if (!DATE_RE.test(row.date)) {
          return NextResponse.json({ error: "לכל תשלום יש להזין תאריך תקין." }, { status: 400 });
        }
        if (!Number.isFinite(row.amount) || row.amount <= 0) {
          return NextResponse.json({ error: "לכל תשלום יש להזין סכום גדול מאפס." }, { status: 400 });
        }
      }

      // If splitting an existing expense, it must exist and not already be paid.
      if (sourceExpenseId) {
        const { data: existing, error: findError } = await supabase
          .from("expenses")
          .select("id,payment_status")
          .eq("id", sourceExpenseId)
          .maybeSingle();
        if (findError) {
          return NextResponse.json({ error: toHebrewError(findError.message) }, { status: 400 });
        }
        if (!existing?.id) {
          return NextResponse.json({ error: "ההוצאה לפיצול לא נמצאה." }, { status: 404 });
        }
        if (existing.payment_status === "paid") {
          return NextResponse.json({ error: "לא ניתן לפצל תשלום ששולם." }, { status: 400 });
        }
      }

      const groupId = randomUUID();
      const count = installments.length;
      const rows = installments.map((row, index) => ({
        expense_date: row.date,
        amount: row.amount,
        category,
        description,
        business_domain: businessDomain,
        project_id: projectId || null,
        order_id: orderId || null,
        property_id: propertyId || null,
        notes,
        recorded_by: user.id,
        payment_status: "not_paid",
        account_id: accountId,
        installment_group_id: groupId,
        installment_index: index + 1,
        installment_count: count,
      }));

      const { data: inserted, error: insertError } = await supabase
        .from("expenses")
        .insert(rows)
        .select("id,expense_date,amount,installment_index,installment_count");

      if (insertError) {
        return NextResponse.json({ error: toHebrewError(insertError.message) }, { status: 400 });
      }
      const createdIds = ((inserted ?? []) as Array<{ id?: string }>)
        .map((r) => r.id)
        .filter((id): id is string => Boolean(id));

      // Link each child to its project (mirrors /api/expenses/create). Best-effort:
      // if a link fails, roll the whole group back so we don't leave orphans.
      if (projectId && createdIds.length > 0) {
        const { error: linkError } = await supabase
          .from("project_expenses")
          .insert(createdIds.map((expenseId) => ({ project_id: projectId, expense_id: expenseId })));
        if (linkError) {
          await supabase.from("expenses").delete().in("id", createdIds);
          return NextResponse.json({ error: toHebrewError(linkError.message) }, { status: 400 });
        }
      }

      // Replace the original obligation only after the children are safely in.
      if (sourceExpenseId) {
        const { error: deleteError } = await supabase.from("expenses").delete().eq("id", sourceExpenseId);
        if (deleteError) {
          await supabase.from("expenses").delete().in("id", createdIds);
          return NextResponse.json({ error: toHebrewError(deleteError.message) }, { status: 400 });
        }
      }

      for (const expenseId of createdIds) {
        await logAuditEvent({
          supabase,
          tableName: "expenses",
          recordId: expenseId,
          action: "create",
          changedBy: profile.id,
          userRole: profile.role,
        });
      }

      return NextResponse.json({ ok: true, group_id: groupId, count, expenses: inserted ?? [] });
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "שגיאה לא צפויה בעת פיצול התשלום.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
