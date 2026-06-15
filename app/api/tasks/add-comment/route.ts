import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    return await withIdempotency(req, supabase, user.id, "tasks/add-comment", async () => {
    const body = (await req.json()) as { task_id?: string; message?: string };
    const taskId = typeof body.task_id === "string" ? body.task_id : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!taskId || !message) {
      return NextResponse.json({ error: "Missing task_id or message" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("task_comments")
      .insert({ task_id: taskId, author_id: profile.id, body: message })
      .select("id,author_id,body,created_at")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({
      ok: true,
      comment: data
        ? {
            id: data.id,
            author_id: data.author_id,
            author_name: profile.full_name ?? profile.email ?? null,
            body: data.body,
            created_at: data.created_at,
          }
        : null,
    });
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
