import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { pingAgainAt } from "@/lib/reminders/ping-again";
import { visibleAudienceRoles } from "@/lib/reminders/worklist";
import { isReminderAction, reminderActionUpdates } from "@/lib/reminders/reminder-action";

// Reminders/Alerts unification — Phase 4: worklist actions.
// Any authenticated user can act on a reminder that belongs to them (assigned or
// created) or is aimed at one of their role buckets. What each action does to
// the row: lib/reminders/reminder-action.ts (shared with the phone, which acts
// on its own copy first and sends the action here).
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: string;
      action?: unknown;
      snooze_until?: unknown;
    };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const action = body.action;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    if (!isReminderAction(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    // Load the row (RLS already limits what the caller can see) and confirm the
    // caller is actually a target of it before mutating.
    const { data: row, error: readError } = await supabase
      .from("reminders")
      .select("id,source,assigned_to,created_by,audience_role")
      .eq("id", id)
      .maybeSingle();
    if (readError) return NextResponse.json({ error: toHebrewError(readError.message) }, { status: 400 });
    if (!row) return NextResponse.json({ error: "התזכורת לא נמצאה או שאין הרשאה." }, { status: 404 });

    const canAct =
      row.assigned_to === profile.id ||
      row.created_by === profile.id ||
      (typeof row.audience_role === "string" && visibleAudienceRoles(profile.role).includes(row.audience_role));
    if (!canAct) return NextResponse.json({ error: "אין הרשאה לפעולה זו." }, { status: 403 });

    const result = reminderActionUpdates(row, action, { snoozeUntil: body.snooze_until, userId: profile.id });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    // Snoozed: it pushes again when the snooze ends (the phone's copy has no
    // notified_at, so this stays out of the shared reminderActionUpdates).
    const updates = action === "snooze" ? { ...result.updates, ...pingAgainAt(result.updates.snoozed_until) } : result.updates;

    const { data, error } = await supabase.from("reminders").update(updates).eq("id", id).select("id");
    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "התזכורת לא נמצאה או שאין הרשאה לעדכן אותה." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "Unknown error") }, { status: 500 });
  }
}
