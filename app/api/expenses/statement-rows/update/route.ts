import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isExpenseBusinessDomain } from "@/lib/expenses";

// Edits a saved statement row by updating the live expense it created (and its project
// link), then mirrors the change onto the row snapshot. Admin/office only.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      row_id?: string;
      business_domain?: string;
      project_id?: string | null;
      property_id?: string | null;
      amount?: number | string;
      category?: string;
      description?: string;
      notes?: string;
      expense_date?: string | null;
      transaction_date?: string | null;
    };

    const rowId = typeof body.row_id === "string" ? body.row_id.trim() : "";
    if (!rowId) return NextResponse.json({ error: "חסר מזהה שורה." }, { status: 400 });

    const businessDomain = typeof body.business_domain === "string" ? body.business_domain.trim() : "";
    if (!isExpenseBusinessDomain(businessDomain)) {
      return NextResponse.json({ error: "יש לבחור תחום עסקי." }, { status: 400 });
    }
    const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
    if (!Number.isFinite(amount)) return NextResponse.json({ error: "סכום לא תקין." }, { status: 400 });
    const expenseDate = typeof body.expense_date === "string" && body.expense_date.trim() ? body.expense_date.trim() : "";
    if (!expenseDate) return NextResponse.json({ error: "חסר תאריך." }, { status: 400 });

    const transactionDate =
      typeof body.transaction_date === "string" && body.transaction_date.trim() ? body.transaction_date.trim() : null;
    const category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : "כרטיס אשראי";
    const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
    const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
    const projectId =
      businessDomain === "logistics_projects" && typeof body.project_id === "string" && body.project_id.trim()
        ? body.project_id.trim()
        : null;
    const propertyId =
      businessDomain === "property_management" && typeof body.property_id === "string" && body.property_id.trim()
        ? body.property_id.trim()
        : null;

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const { data: row, error: rowError } = await supabase
      .from("card_statement_rows")
      .select("id,expense_id")
      .eq("id", rowId)
      .maybeSingle();
    if (rowError) return NextResponse.json({ error: rowError.message }, { status: 400 });
    if (!row?.id) return NextResponse.json({ error: "השורה לא נמצאה." }, { status: 404 });
    const expenseId = typeof row.expense_id === "string" ? row.expense_id : "";
    if (!expenseId) {
      return NextResponse.json({ error: "ההוצאה המקושרת נמחקה ולא ניתן לערוך שורה זו." }, { status: 409 });
    }

    const { error: expenseError } = await supabase
      .from("expenses")
      .update({
        amount,
        category,
        description,
        notes,
        expense_date: expenseDate,
        transaction_date: transactionDate,
        business_domain: businessDomain,
        project_id: projectId,
        property_id: propertyId,
      })
      .eq("id", expenseId);
    if (expenseError) return NextResponse.json({ error: expenseError.message }, { status: 400 });

    // Reconcile the project_expenses link (mirrors create/import behavior).
    const { data: link } = await supabase
      .from("project_expenses")
      .select("project_id")
      .eq("expense_id", expenseId)
      .maybeSingle();
    const currentProject = typeof link?.project_id === "string" ? link.project_id : "";
    if (projectId) {
      if (currentProject && currentProject !== projectId) {
        await supabase.from("project_expenses").delete().eq("expense_id", expenseId);
      }
      if (currentProject !== projectId) {
        await supabase.from("project_expenses").insert({
          project_id: projectId,
          expense_id: expenseId,
          included_in_base_price: false,
          billed_to_customer: false,
          notes: null,
        });
      }
    } else if (currentProject) {
      await supabase.from("project_expenses").delete().eq("expense_id", expenseId);
    }

    // Keep the snapshot in sync so the statement view stays accurate.
    await supabase
      .from("card_statement_rows")
      .update({
        amount,
        category,
        description,
        notes,
        expense_date: expenseDate,
        transaction_date: transactionDate,
        business_domain: businessDomain,
        project_id: projectId,
        property_id: propertyId,
      })
      .eq("id", rowId);

    await logAuditEvent({
      supabase,
      tableName: "expenses",
      recordId: expenseId,
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "עדכון השורה נכשל.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
