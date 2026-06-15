import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";

// Create a reminder attached to a task. Available to anyone who can access the
// task (RLS enforces the rest). Distinct from /api/reminders/create, which is
// admin/office-only and used by the collections center.
export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    return await withIdempotency(req, supabase, user.id, "tasks/reminders/create", async () => {
      const body = (await req.json()) as {
        task_id?: string;
        remind_at?: string;
        content?: string;
        action_type?: string;
        assigned_to?: string | null;
      };

      const taskId = typeof body.task_id === "string" ? body.task_id.trim() : "";
      const remindAt = typeof body.remind_at === "string" ? body.remind_at.trim() : "";
      if (!taskId) return NextResponse.json({ error: "Missing task_id" }, { status: 400 });
      if (!remindAt) return NextResponse.json({ error: "Missing remind_at" }, { status: 400 });

      // Best-effort: read the task to default the assignee to its owner. Don't block
      // on it — the reminders.task_id FK guarantees the task really exists.
      const { data: task } = await supabase
        .from("tasks")
        .select("id,assigned_user_id")
        .eq("id", taskId)
        .maybeSingle();

      const nullable = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
      const assignedTo =
        nullable(body.assigned_to) ??
        (task && typeof task.assigned_user_id === "string" ? task.assigned_user_id : null) ??
        profile.id;

      const { data: reminder, error } = await supabase
        .from("reminders")
        .insert({
          // "" (not null) — the live reminders.content has a legacy NOT-NULL constraint,
          // and a reminder may have no note.
          task_id: taskId,
          remind_at: remindAt,
          content: nullable(body.content) ?? "",
          action_type: nullable(body.action_type) ?? "other",
          category: "task",
          assigned_to: assignedTo,
          created_by: profile.id,
          updated_by: profile.id,
        })
        .select("id,remind_at,content,action_type,status,assigned_to")
        .maybeSingle();

      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true, reminder });
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
