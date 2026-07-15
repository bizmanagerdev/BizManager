import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { visibleAudienceRoles } from "@/lib/reminders/worklist";

// Update a reminder: change status (done / cancelled / pending), reschedule
// (remind_at), edit content, or reassign. Any authenticated user may edit a
// reminder that targets them (assigned to / created by / their role bucket) —
// same permission model as the worklist action route, so editing works from the
// worklist, the order/entity panels, and elsewhere.
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

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    // Confirm the caller is a target of this reminder before mutating (RLS also
    // limits what they can read/write, this returns a clean Hebrew error).
    const { data: row, error: readError } = await supabase
      .from("reminders")
      .select("id,assigned_to,created_by,audience_role")
      .eq("id", id)
      .maybeSingle();
    if (readError) return NextResponse.json({ error: toHebrewError(readError.message) }, { status: 400 });
    if (!row) return NextResponse.json({ error: "התזכורת לא נמצאה או שאין הרשאה." }, { status: 404 });
    const canAct =
      row.assigned_to === profile.id ||
      row.created_by === profile.id ||
      (typeof row.audience_role === "string" && visibleAudienceRoles(profile.role).includes(row.audience_role));
    if (!canAct) return NextResponse.json({ error: "אין הרשאה לעדכן תזכורת זו." }, { status: 403 });

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
