import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { translateToHebrew } from "@/lib/i18n/translateToHebrew";

// A task comment's text changed. Who may: its author, or office/admin — the
// table's own rule (task_comments_update), so a comment someone else wrote
// comes back as not found rather than changed. updated_at is the database's
// (a trigger), and the change log records the old text.
export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    return await withIdempotency(req, supabase, user.id, "tasks/edit-comment", async () => {
      const body = (await req.json()) as { id?: unknown; message?: unknown };
      const id = typeof body.id === "string" ? body.id : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!id || !message) {
        return NextResponse.json({ error: "Missing id or message" }, { status: 400 });
      }

      // As when adding: an Arabic writer's text gets its Hebrew copy; anyone
      // else's edit drops the old copy, which no longer says the same thing.
      const bodyHe = profile.locale === "ar" ? await translateToHebrew(message) : null;

      const { data, error } = await supabase
        .from("task_comments")
        .update({ body: message, body_he: bodyHe })
        .eq("id", id)
        .select("id,author_id,body,body_he,created_at,updated_at")
        .maybeSingle();
      if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
      if (!data) return NextResponse.json({ error: "התגובה לא נמצאה או שאין הרשאה לערוך אותה." }, { status: 404 });

      return NextResponse.json({ ok: true, comment: data });
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "Unknown error") }, { status: 500 });
  }
}
