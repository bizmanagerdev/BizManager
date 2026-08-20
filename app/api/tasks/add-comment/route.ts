import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { translateToHebrew } from "@/lib/i18n/translateToHebrew";

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

    // Office/admin never see Arabic, so a locale=ar worker's own comment is
    // auto-translated to Hebrew here. Skipped entirely for Hebrew writers.
    const bodyHe = profile.locale === "ar" ? await translateToHebrew(message) : null;

    const { data, error } = await supabase
      .from("task_comments")
      .insert({ task_id: taskId, author_id: profile.id, body: message, body_he: bodyHe })
      .select("id,author_id,body,body_he,created_at")
      .maybeSingle();

    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });

    return NextResponse.json({
      ok: true,
      comment: data
        ? {
            id: data.id,
            author_id: data.author_id,
            author_name: profile.full_name ?? profile.email ?? null,
            body: data.body,
            body_he: data.body_he,
            created_at: data.created_at,
          }
        : null,
    });
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
