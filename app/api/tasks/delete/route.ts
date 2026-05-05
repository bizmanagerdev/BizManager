import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { id?: string | null };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const { data: existing, error: existingError } = await supabase
      .from("tasks")
      .select("id,subject,project_id,property_id,assigned_user_id,status,priority,due_date")
      .eq("id", id)
      .maybeSingle<Record<string, unknown>>();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 400 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    await supabase.from("document_links").delete().eq("entity_type", "task").eq("entity_id", id);

    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await logAuditEvent({
      supabase,
      tableName: "tasks",
      recordId: id,
      action: "delete",
      changedBy: profile.id,
      userRole: profile.role,
      oldData: {
        id: typeof existing.id === "string" ? existing.id : id,
        subject: typeof existing.subject === "string" ? existing.subject : null,
        project_id: typeof existing.project_id === "string" ? existing.project_id : null,
        property_id: typeof existing.property_id === "string" ? existing.property_id : null,
        assigned_user_id:
          typeof existing.assigned_user_id === "string" ? existing.assigned_user_id : null,
        status: typeof existing.status === "string" ? existing.status : null,
        priority: typeof existing.priority === "string" ? existing.priority : null,
        due_date: typeof existing.due_date === "string" ? existing.due_date : null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
