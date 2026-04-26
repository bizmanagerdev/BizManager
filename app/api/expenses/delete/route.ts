import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: string;
      project_id?: string | null;
    };

    const expenseId = typeof body.id === "string" ? body.id.trim() : "";
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";

    if (!expenseId || !projectId) {
      return NextResponse.json({ error: "Missing id or project_id" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data: expenseRow, error: expenseReadError } = await supabase
      .from("expenses")
      .select("id,project_id")
      .eq("id", expenseId)
      .maybeSingle();

    if (expenseReadError) {
      return NextResponse.json({ error: expenseReadError.message }, { status: 400 });
    }
    if (!expenseRow?.id || expenseRow.project_id !== projectId) {
      return NextResponse.json({ error: "Expense not found for project" }, { status: 404 });
    }

    const { error: projectExpenseDeleteError } = await supabase
      .from("project_expenses")
      .delete()
      .eq("project_id", projectId)
      .eq("expense_id", expenseId);

    if (projectExpenseDeleteError) {
      return NextResponse.json({ error: projectExpenseDeleteError.message }, { status: 400 });
    }

    const { error: expenseDeleteError } = await supabase
      .from("expenses")
      .delete()
      .eq("id", expenseId)
      .eq("project_id", projectId);

    if (expenseDeleteError) {
      return NextResponse.json({ error: expenseDeleteError.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
