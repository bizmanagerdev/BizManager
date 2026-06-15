import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Update a task reminder: mark done / cancelled / pending, reschedule, or edit
// the note. Available to anyone who can access the task (RLS enforces it).
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: string;
      status?: string;
      remind_at?: string;
      content?: string;
    };

    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const updates: Record<string, unknown> = { updated_by: profile.id };
    if (typeof body.status === "string" && ["pending", "done", "cancelled"].includes(body.status)) {
      updates.status = body.status;
    }
    if (typeof body.remind_at === "string" && body.remind_at.trim()) {
      updates.remind_at = body.remind_at.trim();
    }
    if (typeof body.content === "string") {
      updates.content = body.content.trim() || null;
    }

    const { data, error } = await supabase
      .from("reminders")
      .update(updates)
      .eq("id", id)
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: "התזכורת לא נמצאה או שאין הרשאה לעדכן אותה." },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
