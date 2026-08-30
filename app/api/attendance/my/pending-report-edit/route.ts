import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { PHONE_ATTENDANCE_TABLE } from "@/lib/attendance/phone-reports";
import { parseSelfReportedTime } from "@/lib/attendance/my-shift";
import { translateToHebrew } from "@/lib/i18n/translateToHebrew";

/**
 * Edit a report that's still sitting in the queue (status = pending_review).
 *
 * Nothing has reached payroll yet, so this is a plain UPDATE — scoped by RLS
 * (phone_attendance_worker_edit_pending_own, 20260830150000) to the caller's own
 * row, and only while it's still pending_review. The .eq("status", ...) below
 * closes the race against a concurrent admin approval: if the row was claimed in
 * between, the update matches zero rows and we report it as already handled
 * rather than silently overwriting an approved shift.
 */

const REASON: Record<string, string> = {
  already_reviewed: "הדיווח כבר טופל ולא ניתן לערוך אותו.",
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as {
      report_id?: string;
      clock_in?: string;
      clock_out?: string;
      notes?: string | null;
    };
    const reportId = typeof body.report_id === "string" ? body.report_id.trim() : "";
    if (!reportId) return NextResponse.json({ error: "חסר מזהה דיווח." }, { status: 400 });

    const now = new Date();
    const start = parseSelfReportedTime(body.clock_in, "שעת התחלה", now);
    if ("error" in start) return NextResponse.json({ error: start.error }, { status: 400 });
    const end = parseSelfReportedTime(body.clock_out, "שעת סיום", now);
    if ("error" in end) return NextResponse.json({ error: end.error }, { status: 400 });
    if (end.date <= start.date) {
      return NextResponse.json({ error: "שעת הסיום חייבת להיות אחרי שעת ההתחלה." }, { status: 400 });
    }

    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";
    // Office/admin never see Arabic, so a locale=ar worker's own note is
    // auto-translated to Hebrew here, same as the correction flow.
    const notesHe = profile.locale === "ar" && notes ? await translateToHebrew(notes) : null;
    const workedMinutes = Math.max(0, Math.round((end.date.getTime() - start.date.getTime()) / 60000));

    const { data, error } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .update({
        clock_in: start.date.toISOString(),
        clock_out: end.date.toISOString(),
        worked_minutes: workedMinutes,
        notes: notes || null,
        notes_he: notesHe,
        updated_at: now.toISOString(),
      })
      .eq("id", reportId)
      .eq("status", "pending_review")
      .select("id")
      .maybeSingle();

    if (error) return NextResponse.json({ error: toHebrewError(error.message, "עדכון הדיווח נכשל.") }, { status: 400 });
    if (!data?.id) return NextResponse.json({ error: REASON.already_reviewed }, { status: 409 });

    await logAuditEvent({
      supabase,
      tableName: PHONE_ATTENDANCE_TABLE,
      recordId: reportId,
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה בעדכון הדיווח.") }, { status: 500 });
  }
}
