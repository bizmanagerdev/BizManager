import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { minutesBetween } from "@/lib/payroll";
import { PHONE_ATTENDANCE_TABLE } from "@/lib/attendance/phone-reports";
import { parseSelfReportedTime } from "@/lib/attendance/my-shift";
import { translateToHebrew } from "@/lib/i18n/translateToHebrew";

/**
 * "סיום ושליחה לאישור" — the worker clocks himself OUT and submits the shift.
 *
 * The row moves open → pending_review, which is where the boss picks it up in
 * the payroll queue to mark the business domain and approve it. Only then does
 * an attendance_sessions row (and therefore any pay) exist. A note is optional
 * and exists to help that classification ("נסעתי לאתר בראשון").
 *
 * Like the clock-IN, the end time may be set by hand: forgetting to clock out at
 * 17:00 and remembering at 20:00 is the same problem as forgetting to clock in.
 * It can't be in the future and can't be before the shift started.
 */

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as { notes?: string | null; clock_out?: string | null };
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";

    const { data: openReport, error: openError } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .select("id,clock_in,notes")
      .eq("user_id", profile.id)
      .eq("status", "open")
      .maybeSingle();

    if (openError) return NextResponse.json({ error: toHebrewError(openError.message) }, { status: 400 });
    if (!openReport?.id) return NextResponse.json({ error: "אין לך משמרת פתוחה." }, { status: 404 });

    const now = new Date();
    let clockOut = now;
    if (typeof body.clock_out === "string" && body.clock_out.trim()) {
      const parsed = parseSelfReportedTime(body.clock_out, "שעת הסיום", now);
      if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
      clockOut = parsed.date;
    }

    const clockIn = new Date(openReport.clock_in as string);
    if (Number.isNaN(clockIn.getTime()) || clockOut <= clockIn) {
      return NextResponse.json({ error: "שעת הסיום חייבת להיות אחרי שעת הפתיחה." }, { status: 400 });
    }

    // Keep whatever was written when the shift opened and append the closing
    // note, so neither one silently overwrites the other.
    const existingNotes = typeof openReport.notes === "string" ? openReport.notes.trim() : "";
    const mergedNotes = [existingNotes, notes].filter(Boolean).join(" · ") || null;
    // Office/admin never see Arabic, so a locale=ar worker's own note is
    // auto-translated to Hebrew here. Translating the merged text (rather than
    // concatenating two separately-translated halves) keeps it coherent.
    const mergedNotesHe =
      profile.locale === "ar" && mergedNotes ? await translateToHebrew(mergedNotes) : null;

    // Guarded on status='open' so a double-tap (or a phone clock-out racing the
    // app) can't submit the same shift twice.
    const { data: updated, error: updateError } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .update({
        clock_out: clockOut.toISOString(),
        worked_minutes: minutesBetween(clockIn, clockOut),
        status: "pending_review",
        notes: mergedNotes,
        notes_he: mergedNotesHe,
        // The row was touched NOW, whatever hour the shift is said to have ended.
        updated_at: now.toISOString(),
      })
      .eq("id", openReport.id)
      .eq("status", "open")
      .select("id,clock_in,clock_out,worked_minutes")
      .maybeSingle();

    if (updateError) return NextResponse.json({ error: toHebrewError(updateError.message) }, { status: 400 });
    if (!updated?.id) return NextResponse.json({ error: "המשמרת כבר נסגרה." }, { status: 409 });

    await logAuditEvent({
      supabase,
      tableName: PHONE_ATTENDANCE_TABLE,
      recordId: updated.id,
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ ok: true, session: updated });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה בסגירת המשמרת.") }, { status: 500 });
  }
}
