import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

const DOCUMENTS_BUCKET = "business-documents";

type DeleteProjectPayload = {
  id?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as DeleteProjectPayload;
    const id = typeof body.id === "string" ? body.id.trim() : "";

    if (!id) {
      return NextResponse.json({ error: "Missing project id" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const { data: project, error: projectReadError } = await supabase
      .from("projects")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (projectReadError) {
      return NextResponse.json({ error: projectReadError.message }, { status: 400 });
    }
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const { data: taskRows, error: tasksReadError } = await supabase
      .from("tasks")
      .select("id")
      .eq("project_id", id);

    if (tasksReadError) {
      return NextResponse.json({ error: tasksReadError.message }, { status: 400 });
    }

    const taskIds = (taskRows ?? [])
      .map((row) => (typeof row.id === "string" ? row.id : null))
      .filter((value): value is string => Boolean(value));

    const documentIds = new Set<string>();

    const { data: projectDocumentLinks, error: projectDocumentLinksError } = await supabase
      .from("document_links")
      .select("document_id")
      .eq("entity_type", "project")
      .eq("entity_id", id);

    if (projectDocumentLinksError) {
      return NextResponse.json({ error: projectDocumentLinksError.message }, { status: 400 });
    }

    for (const row of projectDocumentLinks ?? []) {
      if (typeof row.document_id === "string") documentIds.add(row.document_id);
    }

    if (taskIds.length > 0) {
      const { data: taskDocumentLinks, error: taskDocumentLinksError } = await supabase
        .from("document_links")
        .select("document_id")
        .eq("entity_type", "task")
        .in("entity_id", taskIds);

      if (taskDocumentLinksError) {
        return NextResponse.json({ error: taskDocumentLinksError.message }, { status: 400 });
      }

      for (const row of taskDocumentLinks ?? []) {
        if (typeof row.document_id === "string") documentIds.add(row.document_id);
      }
    }

    const documentIdList = Array.from(documentIds);
    let storageKeys: string[] = [];

    if (documentIdList.length > 0) {
      const { data: documentRows, error: documentsReadError } = await supabase
        .from("documents")
        .select("id,storage_key")
        .in("id", documentIdList);

      if (documentsReadError) {
        return NextResponse.json({ error: documentsReadError.message }, { status: 400 });
      }

      storageKeys = (documentRows ?? [])
        .map((row) => (typeof row.storage_key === "string" ? row.storage_key : null))
        .filter((value): value is string => Boolean(value));
    }

    const { data: expenseLinks, error: expenseLinksError } = await supabase
      .from("project_expenses")
      .select("expense_id")
      .eq("project_id", id);

    if (expenseLinksError) {
      return NextResponse.json({ error: expenseLinksError.message }, { status: 400 });
    }

    const expenseIds = (expenseLinks ?? [])
      .map((row) => (typeof row.expense_id === "string" ? row.expense_id : null))
      .filter((value): value is string => Boolean(value));

    const { error: paymentsDeleteError } = await supabase
      .from("payments")
      .delete()
      .eq("project_id", id);

    if (paymentsDeleteError) {
      return NextResponse.json({ error: paymentsDeleteError.message }, { status: 400 });
    }

    const { error: projectExpenseDeleteError } = await supabase
      .from("project_expenses")
      .delete()
      .eq("project_id", id);

    if (projectExpenseDeleteError) {
      return NextResponse.json({ error: projectExpenseDeleteError.message }, { status: 400 });
    }

    if (expenseIds.length > 0) {
      const { error: expensesDeleteError } = await supabase
        .from("expenses")
        .delete()
        .in("id", expenseIds);

      if (expensesDeleteError) {
        return NextResponse.json({ error: expensesDeleteError.message }, { status: 400 });
      }
    }

    if (taskIds.length > 0) {
      const { error: tasksDeleteError } = await supabase
        .from("tasks")
        .delete()
        .eq("project_id", id);

      if (tasksDeleteError) {
        return NextResponse.json({ error: tasksDeleteError.message }, { status: 400 });
      }
    }

    const { error: projectDocumentLinkDeleteError } = await supabase
      .from("document_links")
      .delete()
      .eq("entity_type", "project")
      .eq("entity_id", id);

    if (projectDocumentLinkDeleteError) {
      return NextResponse.json({ error: projectDocumentLinkDeleteError.message }, { status: 400 });
    }

    if (taskIds.length > 0) {
      const { error: taskDocumentLinkDeleteError } = await supabase
        .from("document_links")
        .delete()
        .eq("entity_type", "task")
        .in("entity_id", taskIds);

      if (taskDocumentLinkDeleteError) {
        return NextResponse.json({ error: taskDocumentLinkDeleteError.message }, { status: 400 });
      }
    }

    if (documentIdList.length > 0) {
      const { error: documentsDeleteError } = await supabase
        .from("documents")
        .delete()
        .in("id", documentIdList);

      if (documentsDeleteError) {
        return NextResponse.json({ error: documentsDeleteError.message }, { status: 400 });
      }
    }

    const { error: projectDeleteError } = await supabase.from("projects").delete().eq("id", id);

    if (projectDeleteError) {
      return NextResponse.json({ error: projectDeleteError.message }, { status: 400 });
    }

    await logAuditEvent({
      supabase,
      tableName: "projects",
      recordId: id,
      action: "delete",
      changedBy: profile.id,
      userRole: profile.role,
    });

    if (storageKeys.length > 0) {
      const { error: storageDeleteError } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .remove(storageKeys);

      if (storageDeleteError) {
        return NextResponse.json(
          {
            ok: true,
            warning: `Project deleted but file cleanup failed: ${storageDeleteError.message}`,
          },
          { status: 200 }
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
