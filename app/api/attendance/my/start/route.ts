import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { normalizePayrollWorkerType, payrollWorkerTypeAllowsSessions } from "@/lib/payroll-worker-type";
import { PHONE_ATTENDANCE_TABLE } from "@/lib/attendance/phone-reports";
import { APP_ATTENDANCE_SOURCE, parseSelfReportedTime } from "@/lib/attendance/my-shift";
import { translateToHebrew } from "@/lib/i18n/translateToHebrew";

/**
 * "פתיחת משמרת" — the worker clocks himself IN.
 *
 * Deliberately narrow: the caller can only open a shift for HIMSELF, and it lands
 * as a report awaiting approval, never as an attendance_sessions row. The
 * business domain is NOT asked for here; an admin classifies it when approving,
 * which is the whole point of the queue.
 *
 * The start time may be backdated — a driver who only remembers to clock in at
 * 10:00 should be able to say he started at 08:00 rather than lose two hours or
 * chase the office. It can't be in the future (that's a typo, not a shift) and
 * can't be more than a week back; anything older is a whole missed shift, which
 * the boss enters from the payroll queue.
 */

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as { notes?: string | null; clock_in?: string | null };
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";

    const now = new Date();
    let clockIn = now;
    if (typeof body.clock_in === "string" && body.clock_in.trim()) {
      const parsed = parseSelfReportedTime(body.clock_in, "שעת הפתיחה", now);
      if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
      clockIn = parsed.date;
    }

    const { data: me, error: meError } = await supabase
      .from("users")
      .select("id,active,payroll_worker_type,pay_tracking_mode")
      .eq("id", profile.id)
      .maybeSingle();

    if (meError) return NextResponse.json({ error: toHebrewError(meError.message) }, { status: 400 });
    if (!me?.id) return NextResponse.json({ error: "המשתמש לא נמצא." }, { status: 404 });
    if (me.active === false) return NextResponse.json({ error: "החשבון אינו פעיל." }, { status: 403 });

    const workerType = normalizePayrollWorkerType(me.payroll_worker_type, me.pay_tracking_mode);
    if (!payrollWorkerTypeAllowsSessions(workerType)) {
      return NextResponse.json({ error: "סוג העובד שלך לא מתעד משמרות." }, { status: 409 });
    }

    // Office/admin never see Arabic, so a locale=ar worker's own note is
    // auto-translated to Hebrew here. Skipped entirely for Hebrew writers.
    const notesHe = profile.locale === "ar" && notes ? await translateToHebrew(notes) : null;

    const { data: inserted, error: insertError } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .insert({
        user_id: profile.id,
        clock_in: clockIn.toISOString(),
        status: "open",
        source: APP_ATTENDANCE_SOURCE,
        // Self-reported: subject and reporter are the same person.
        reported_by: profile.id,
        notes: notes || null,
        notes_he: notesHe,
      })
      .select("id,clock_in")
      .maybeSingle();

    if (insertError) {
      // The partial unique index (one open shift per worker) — he already
      // clocked in, here or by phone, and forgot.
      if (insertError.code === "23505") {
        return NextResponse.json({ error: "כבר יש לך משמרת פתוחה." }, { status: 409 });
      }
      return NextResponse.json({ error: toHebrewError(insertError.message) }, { status: 400 });
    }

    if (inserted?.id) {
      await logAuditEvent({
        supabase,
        tableName: PHONE_ATTENDANCE_TABLE,
        recordId: inserted.id,
        action: "create",
        changedBy: profile.id,
        userRole: profile.role,
      });
    }

    return NextResponse.json({ ok: true, id: inserted?.id ?? null, clock_in: inserted?.clock_in ?? null });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה בפתיחת המשמרת.") }, { status: 500 });
  }
}
