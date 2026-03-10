import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      project_id?: string;
      customer_id?: string;
      subject?: string;
      description?: string;
      due_date?: string | null;
      assigned_user_id?: string | null;
      priority?: string | null;
      status?: string | null;
    };

    const projectId = typeof body.project_id === "string" ? body.project_id : "";
    const customerId = typeof body.customer_id === "string" ? body.customer_id : null;
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const dueDate = typeof body.due_date === "string" ? body.due_date : body.due_date ?? null;
    const assignedUserId = typeof body.assigned_user_id === "string" ? body.assigned_user_id : body.assigned_user_id ?? null;
    const priority = typeof body.priority === "string" ? body.priority : body.priority ?? null;
    const status = typeof body.status === "string" ? body.status : body.status ?? null;

    if (!projectId || !customerId || !subject || !dueDate || !assignedUserId || !priority || !status) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        project_id: projectId,
        customer_id: customerId,
        assigned_user_id: assignedUserId,
        subject,
        description,
        due_date: dueDate,
        priority,
        status,
      })
      .select("*")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ task: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
