import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: string;
      project_id?: string | null;
      amount?: number | string;
      category?: string;
      description?: string;
      notes?: string;
      expense_date?: string | null;
      included_in_base_price?: boolean;
      billed_to_customer?: boolean;
      project_expense_notes?: string;
    };

    const expenseId = typeof body.id === "string" ? body.id.trim() : "";
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const projectExpenseNotes =
      typeof body.project_expense_notes === "string" ? body.project_expense_notes.trim() : null;
    const amountNumber =
      typeof body.amount === "number" ? body.amount : typeof body.amount === "string" ? Number(body.amount) : NaN;
    const expenseDate = typeof body.expense_date === "string" ? body.expense_date : null;

    if (!expenseId || !projectId) {
      return NextResponse.json({ error: "Missing id or project_id" }, { status: 400 });
    }
    if (!category || !Number.isFinite(amountNumber) || amountNumber <= 0) {
      return NextResponse.json({ error: "Missing category or amount" }, { status: 400 });
    }
    if (!expenseDate) {
      return NextResponse.json({ error: "Missing expense_date" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data: expenseRow, error: expenseReadError } = await supabase
      .from("expenses")
      .select("id,project_id")
      .eq("id", expenseId)
      .maybeSingle();

    if (expenseReadError) return NextResponse.json({ error: expenseReadError.message }, { status: 400 });
    if (!expenseRow?.id || expenseRow.project_id !== projectId) {
      return NextResponse.json({ error: "Expense not found for project" }, { status: 404 });
    }

    const { data: expense, error: expenseError } = await supabase
      .from("expenses")
      .update({
        amount: amountNumber,
        category,
        description,
        notes,
        expense_date: expenseDate,
      })
      .eq("id", expenseId)
      .select(
        "id,expense_date,amount,category,description,business_domain,project_id,order_id,property_id,notes,recorded_by,created_at,updated_at"
      )
      .maybeSingle();

    if (expenseError) return NextResponse.json({ error: expenseError.message }, { status: 400 });

    const { data: projectExpense, error: projectExpenseError } = await supabase
      .from("project_expenses")
      .update({
        included_in_base_price: Boolean(body.included_in_base_price),
        billed_to_customer: Boolean(body.billed_to_customer),
        notes: projectExpenseNotes,
      })
      .eq("project_id", projectId)
      .eq("expense_id", expenseId)
      .select("id,project_id,expense_id,included_in_base_price,billed_to_customer,notes")
      .maybeSingle();

    if (projectExpenseError) {
      return NextResponse.json({ error: projectExpenseError.message }, { status: 400 });
    }

    return NextResponse.json({ expense, projectExpense });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
