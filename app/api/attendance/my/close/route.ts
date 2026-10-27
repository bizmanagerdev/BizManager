import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEventAfterResponse } from "@/lib/audit-after";
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
 *
 * The phone sends it again when it never heard the answer (a weak signal: the
 * close arrived, the reply didn't), from its send queue — hours or days later.
 * That repeat is answered "done", not "no shift open": סאלח's phone showed two
 * such closes as failed for good (Sentry, 24–25/10) though both shifts were
 * closed. The close names its shift (report_id), so it never closes another;
 * one queued before it did is recognised by its end time.
 */

/** The shift this close already ended, when it's a repeat of one that arrived. */
async function alreadyClosed(supabase: SupabaseClient, userId: string, reportId: string | null, clockOutRaw: unknown) {
  let query = supabase
    .from(PHONE_ATTENDANCE_TABLE)
    .select("id,clock_in,clock_out,worked_minutes")
    .eq("user_id", userId)
    .neq("status", "open");
  if (reportId) {
    query = query.eq("id", reportId);
  } else {
    const at = typeof clockOutRaw === "string" ? new Date(clockOutRaw.trim()) : null;
    if (!at || Number.isNaN(at.getTime())) return null;
    query = query.eq("clock_out", at.toISOString());
  }
  const { data } = await query.limit(1).maybeSingle();
  return data?.id ? data : null;
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as {
      notes?: string | null;
      clock_out?: string | null;
      report_id?: string | null;
    };
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";
    const reportId = typeof body.report_id === "string" && body.report_id.trim() ? body.report_id.trim() : null;

    // Every refusal first checks whether this close already went through.
    const refuse = async (error: string, status: number) => {
      const done = await alreadyClosed(supabase, profile.id, reportId, body.clock_out);
      if (done) return NextResponse.json({ ok: true, session: done, repeat: true });
      return NextResponse.json({ error }, { status });
    };

    const { data: openReport, error: openError } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .select("id,clock_in,notes")
      .eq("user_id", profile.id)
      .eq("status", "open")
      .maybeSingle();

    if (openError) return NextResponse.json({ error: toHebrewError(openError.message) }, { status: 400 });
    if (!openReport?.id) return refuse("אין לך משמרת פתוחה.", 404);
    // A shift opened since is never this close's.
    if (reportId && openReport.id !== reportId) return refuse("המשמרת הזו כבר לא פתוחה.", 404);

    const now = new Date();
    let clockOut = now;
    if (typeof body.clock_out === "string" && body.clock_out.trim()) {
      const parsed = parseSelfReportedTime(body.clock_out, "שעת הסיום", now);
      if ("error" in parsed) return refuse(parsed.error, 400);
      clockOut = parsed.date;
    }

    const clockIn = new Date(openReport.clock_in as string);
    if (Number.isNaN(clockIn.getTime()) || clockOut <= clockIn) {
      return refuse("שעת הסיום חייבת להיות אחרי שעת הפתיחה.", 400);
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
    if (!updated?.id) return refuse("המשמרת כבר נסגרה.", 409);

    logAuditEventAfterResponse({
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
