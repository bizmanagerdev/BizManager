import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      project_id?: string;
      amount?: number | string;
      category?: string;
      description?: string;
      notes?: string;
      expense_date?: string | null;
      included_in_base_price?: boolean;
      billed_to_customer?: boolean;
      project_expense_notes?: string;
    };

    const projectId = typeof body.project_id === "string" ? body.project_id : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;

    const includedInBasePrice = Boolean(body.included_in_base_price);
    const billedToCustomer = Boolean(body.billed_to_customer);
    const projectExpenseNotes = typeof body.project_expense_notes === "string" ? body.project_expense_notes.trim() : null;

    const amountNumber =
      typeof body.amount === "number" ? body.amount : typeof body.amount === "string" ? Number(body.amount) : NaN;

    if (!projectId || !category || !Number.isFinite(amountNumber)) {
      return NextResponse.json({ error: "Missing project_id, category, or amount" }, { status: 400 });
    }

    const expenseDate = typeof body.expense_date === "string" ? body.expense_date : null;
    if (!expenseDate) {
      return NextResponse.json({ error: "Missing expense_date" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id,project_type")
      .eq("id", projectId)
      .maybeSingle();

    if (projectError) {
      return NextResponse.json({ error: projectError.message }, { status: 400 });
    }
    if (!project || typeof project.project_type !== "string" || !project.project_type.trim()) {
      return NextResponse.json({ error: "Invalid project_id or missing project_type" }, { status: 400 });
    }

    const businessDomain = project.project_type.trim();

    const { data: expense, error: expenseError } = await supabase
      .from("expenses")
      .insert({
        expense_date: expenseDate,
        amount: amountNumber,
        category,
        description,
        business_domain: businessDomain,
        notes,
        recorded_by: user.id,
      })
      .select("id,expense_date,amount,category,description,business_domain,notes,recorded_by,created_at,updated_at")
      .maybeSingle();

    if (expenseError) return NextResponse.json({ error: expenseError.message }, { status: 400 });
    if (!expense?.id) return NextResponse.json({ error: "Failed to create expense" }, { status: 500 });

    const { error: linkError } = await supabase.from("project_expenses").insert({
      project_id: projectId,
      expense_id: expense.id,
      included_in_base_price: includedInBasePrice,
      billed_to_customer: billedToCustomer,
      notes: projectExpenseNotes,
    });

    if (linkError) {
      await supabase.from("expenses").delete().eq("id", expense.id);
      return NextResponse.json({ error: linkError.message }, { status: 400 });
    }

    return NextResponse.json({ expense });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
