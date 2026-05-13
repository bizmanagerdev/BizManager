import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: string;
      project_id?: string | null;
      order_id?: string | null;
      property_id?: string | null;
    };

    const expenseId = typeof body.id === "string" ? body.id.trim() : "";
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
    const propertyId = typeof body.property_id === "string" ? body.property_id.trim() : "";

    if (!expenseId) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    if ([projectId, orderId, propertyId].filter(Boolean).length > 1) {
      return NextResponse.json(
        { error: "Only one of project_id, order_id, or property_id can be provided" },
        { status: 400 }
      );
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const [{ data: expenseRow, error: expenseReadError }, { data: projectExpenseRow, error: projectExpenseReadError }] =
      await Promise.all([
        supabase
          .from("expenses")
          .select("id,project_id,order_id,property_id")
          .eq("id", expenseId)
          .maybeSingle(),
        supabase
          .from("project_expenses")
          .select("project_id")
          .eq("expense_id", expenseId)
          .maybeSingle(),
      ]);

    if (expenseReadError) {
      return NextResponse.json({ error: expenseReadError.message }, { status: 400 });
    }
    if (projectExpenseReadError) {
      return NextResponse.json({ error: projectExpenseReadError.message }, { status: 400 });
    }
    if (!expenseRow?.id) {
      return NextResponse.json({ error: "Expense not found" }, { status: 404 });
    }

    const effectiveProjectId = expenseRow.project_id || projectExpenseRow?.project_id || "";
    const effectiveOrderId = expenseRow.order_id || "";
    const effectivePropertyId = expenseRow.property_id || "";

    if (effectiveProjectId && projectId !== effectiveProjectId) {
      return NextResponse.json({ error: "Expense not found for project" }, { status: 404 });
    }
    if (effectiveOrderId && orderId !== effectiveOrderId) {
      return NextResponse.json({ error: "Expense not found for order" }, { status: 404 });
    }
    if (effectivePropertyId && propertyId !== effectivePropertyId) {
      return NextResponse.json({ error: "Expense not found for property" }, { status: 404 });
    }
    if (!effectiveProjectId && projectId) {
      return NextResponse.json({ error: "Expense not found for project" }, { status: 404 });
    }
    if (!effectiveOrderId && orderId) {
      return NextResponse.json({ error: "Expense not found for order" }, { status: 404 });
    }
    if (!effectivePropertyId && propertyId) {
      return NextResponse.json({ error: "Expense not found for property" }, { status: 404 });
    }

    const { error: projectExpenseDeleteError } = await supabase
      .from("project_expenses")
      .delete()
      .eq("expense_id", expenseId);

    if (projectExpenseDeleteError) {
      return NextResponse.json({ error: projectExpenseDeleteError.message }, { status: 400 });
    }

    const { error: expenseDeleteError } = await supabase
      .from("expenses")
      .delete()
      .eq("id", expenseId);

    if (expenseDeleteError) {
      return NextResponse.json({ error: expenseDeleteError.message }, { status: 400 });
    }

    await logAuditEvent({
      supabase,
      tableName: "expenses",
      recordId: expenseId,
      action: "delete",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
