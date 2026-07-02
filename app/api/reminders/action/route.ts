import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { visibleAudienceRoles } from "@/lib/reminders/worklist";

// Reminders/Alerts unification — Phase 4: worklist actions.
// Any authenticated user can act on a reminder that belongs to them (assigned or
// created) or is aimed at one of their role buckets. Actions:
//   done    -> close it (manual + system alike)
//   dismiss -> manual: cancel; system: snooze to tomorrow (re-appears daily
//              until the underlying issue is resolved by the sync job)
//   snooze  -> hide until a caller-provided timestamp
//   reopen  -> back to the active worklist
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: string;
      action?: "done" | "dismiss" | "snooze" | "reopen";
      snooze_until?: string;
    };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const action = body.action;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    if (!action || !["done", "dismiss", "snooze", "reopen"].includes(action)) {
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

    const nowIso = new Date().toISOString();
    const isSystem = row.source === "system";
    const updates: Record<string, unknown> = { updated_by: profile.id, updated_at: nowIso };

    if (action === "done") {
      updates.status = isSystem ? "auto_resolved" : "done";
      updates.resolved_at = nowIso;
    } else if (action === "reopen") {
      updates.status = "pending";
      updates.snoozed_until = null;
    } else if (action === "snooze") {
      const until = typeof body.snooze_until === "string" ? new Date(body.snooze_until) : null;
      if (!until || Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
        return NextResponse.json({ error: "מועד דחייה לא תקין." }, { status: 400 });
      }
      updates.snoozed_until = until.toISOString();
      updates.snoozed_by = profile.id;
    } else if (action === "dismiss") {
      if (isSystem) {
        // Clear it for today; the hourly sync re-opens it tomorrow if the issue
        // still exists. Tomorrow ~06:00 Israel ≈ 04:00 UTC.
        const t = new Date();
        t.setUTCHours(4, 0, 0, 0);
        if (t.getTime() <= Date.now()) t.setUTCDate(t.getUTCDate() + 1);
        updates.snoozed_until = t.toISOString();
        updates.snoozed_by = profile.id;
      } else {
        updates.status = "cancelled";
        updates.resolved_at = nowIso;
      }
    }

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
