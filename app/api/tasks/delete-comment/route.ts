import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";

// A task comment deleted. Who may: its author, or office/admin — the table's
// own rule (task_comments_delete). A comment that's already gone is done (a
// repeat of this same delete); one this person may see but not delete is
// refused. The change log keeps the deleted text.
export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    return await withIdempotency(req, supabase, user.id, "tasks/delete-comment", async () => {
      const body = (await req.json()) as { id?: unknown };
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

      const { data, error } = await supabase.from("task_comments").delete().eq("id", id).select("id");
      if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
      if ((data ?? []).length > 0) return NextResponse.json({ ok: true });

      const { data: still } = await supabase.from("task_comments").select("id").eq("id", id).maybeSingle();
      if (still) return NextResponse.json({ error: "אין הרשאה למחוק תגובה זו." }, { status: 403 });
      return NextResponse.json({ ok: true });
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "Unknown error") }, { status: 500 });
  }
}
