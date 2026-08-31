import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { PHONE_ATTENDANCE_TABLE } from "@/lib/attendance/phone-reports";
import { FUTURE_TOLERANCE_MS } from "@/lib/attendance/my-shift";

/**
 * Admin/office fix-up of a report still sitting in the queue (status =
 * pending_review) — clock in/out and the note. Separate from
 * /api/attendance/my/pending-report-edit (the worker's own self-service
 * route): that one caps how far back a worker may date his own attendance
 * (MAX_BACKDATE_DAYS = 7, "anything older is a payroll correction, which the
 * boss makes from the queue"), which is exactly the case here — an admin
 * fixing an older report can't be held to the same limit.
 *
 * Still a plain UPDATE, same as approve/reject: nothing has reached payroll
 * yet, so there's no session to recalculate — approve() prices the session
 * from whatever clock_in/clock_out it finds once it runs.
 */

type Body = { report_id?: string; clock_in?: string; clock_out?: string; notes?: string | null };

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as Body;
    const reportId = typeof body.report_id === "string" ? body.report_id.trim() : "";
    if (!reportId) return NextResponse.json({ error: "חסר מזהה דיווח." }, { status: 400 });

    const clockIn = typeof body.clock_in === "string" ? new Date(body.clock_in) : null;
    if (!clockIn || Number.isNaN(clockIn.getTime())) return NextResponse.json({ error: "שעת התחלה אינה תקינה." }, { status: 400 });
    const clockOut = typeof body.clock_out === "string" ? new Date(body.clock_out) : null;
    if (!clockOut || Number.isNaN(clockOut.getTime())) return NextResponse.json({ error: "שעת סיום אינה תקינה." }, { status: 400 });
    if (clockOut.getTime() <= clockIn.getTime()) return NextResponse.json({ error: "שעת הסיום חייבת להיות אחרי שעת ההתחלה." }, { status: 400 });
    if (clockOut.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
      return NextResponse.json({ error: "שעת הסיום לא יכולה להיות בעתיד." }, { status: 400 });
    }

    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";
    const workedMinutes = Math.max(0, Math.round((clockOut.getTime() - clockIn.getTime()) / 60000));

    // The note carries a Hebrew translation (notes_he) when it was auto-translated
    // from a locale=ar worker's own words. Only clear it when the TEXT actually
    // changed — an admin who only fixed the times must not silently wipe out a
    // translation that still describes the (unchanged) note.
    const { data: existing, error: fetchError } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .select("notes, notes_he")
      .eq("id", reportId)
      .eq("status", "pending_review")
      .maybeSingle();
    if (fetchError) return NextResponse.json({ error: toHebrewError(fetchError.message) }, { status: 400 });
    if (!existing) return NextResponse.json({ error: "הדיווח כבר טופל." }, { status: 409 });
    const noteChanged = notes !== ((existing.notes as string | null) ?? "");

    const { data: updated, error } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .update({
        clock_in: clockIn.toISOString(),
        clock_out: clockOut.toISOString(),
        worked_minutes: workedMinutes,
        notes: notes || null,
        notes_he: noteChanged ? null : existing.notes_he,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reportId)
      .eq("status", "pending_review")
      .select("id")
      .maybeSingle();

    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    if (!updated?.id) return NextResponse.json({ error: "הדיווח כבר טופל." }, { status: 409 });

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
