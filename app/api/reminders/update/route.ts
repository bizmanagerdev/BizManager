import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Update a reminder: change status (done / cancelled / pending), reschedule
// (remind_at), or edit content.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: string;
      status?: string;
      remind_at?: string;
      content?: string;
      assigned_to?: string | null;
    };

    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
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
    if ("assigned_to" in body) {
      const assignee = typeof body.assigned_to === "string" ? body.assigned_to.trim() : "";
      updates.assigned_to = assignee || null;
    }

    const { data, error } = await supabase
      .from("reminders")
      .update(updates)
      .eq("id", id)
      .select("id");
    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    // No row came back → the update matched nothing the caller may change (wrong
    // id, or blocked by row-level security). Surface it instead of a false "ok".
    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: "התזכורת לא נמצאה או שאין הרשאה לעדכן אותה." },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
