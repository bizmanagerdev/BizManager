import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { normalizePayrollWorkerType, payrollWorkerTypeAllowsSessions } from "@/lib/payroll-worker-type";
import { minutesBetween, WORK_SESSIONS_TABLE } from "@/lib/payroll";
import { PHONE_ATTENDANCE_TABLE } from "@/lib/attendance/phone-reports";
import { APP_ATTENDANCE_SOURCE, parseSelfReportedTime } from "@/lib/attendance/my-shift";

/**
 * "דיווח על משמרת שהסתיימה" — a whole past shift, start and end together.
 *
 * For the case the open/close pair can't serve: he never touched the app that
 * day. Rather than phone the office, he reports 08:00–16:00 and it lands in the
 * SAME queue as everything else (pending_review, source 'app'), where the boss
 * classifies the domain and approves it. Nothing here writes payroll.
 *
 * Both times run through the shared self-reporting rules (not future, not more
 * than a week back). On top of that we refuse a shift that overlaps hours he has
 * already reported or had approved — the easiest mistake here is filing the same
 * day twice, and a duplicate is a real pay claim once the boss approves it.
 */
export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as {
      clock_in?: string | null;
      clock_out?: string | null;
      notes?: string | null;
    };
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";

    const now = new Date();
    const start = parseSelfReportedTime(body.clock_in, "שעת התחלה", now);
    if ("error" in start) return NextResponse.json({ error: start.error }, { status: 400 });
    const end = parseSelfReportedTime(body.clock_out, "שעת סיום", now);
    if ("error" in end) return NextResponse.json({ error: end.error }, { status: 400 });

    if (end.date <= start.date) {
      return NextResponse.json({ error: "שעת הסיום חייבת להיות אחרי שעת ההתחלה." }, { status: 400 });
    }
    const workedMinutes = minutesBetween(start.date, end.date);
    if (workedMinutes > 24 * 60) {
      return NextResponse.json({ error: "משמרת אחת לא יכולה להיות ארוכה מ-24 שעות." }, { status: 400 });
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

    // ── Don't let the same hours be claimed twice ──────────────────────────────
    // Two half-open ranges overlap when each starts before the other ends. An
    // open report has no end yet, so treat it as running to "now".
    const startIso = start.date.toISOString();
    const endIso = end.date.toISOString();
    const overlaps = (otherStart: string, otherEnd: string | null) => {
      const otherStartMs = new Date(otherStart).getTime();
      const otherEndMs = otherEnd ? new Date(otherEnd).getTime() : now.getTime();
      if (!Number.isFinite(otherStartMs)) return false;
      return start.date.getTime() < otherEndMs && otherStartMs < end.date.getTime();
    };

    const [reportsResult, sessionsResult] = await Promise.all([
      supabase
        .from(PHONE_ATTENDANCE_TABLE)
        .select("clock_in,clock_out,status")
        .eq("user_id", profile.id)
        .in("status", ["open", "pending_review", "approved"])
        .gte("clock_in", new Date(start.date.getTime() - 36 * 60 * 60 * 1000).toISOString())
        .range(0, 199),
      supabase
        .from(WORK_SESSIONS_TABLE)
        .select("clock_in,clock_out")
        .eq("user_id", profile.id)
        .gte("clock_in", new Date(start.date.getTime() - 36 * 60 * 60 * 1000).toISOString())
        .range(0, 199),
    ]);

    const clash =
      ((reportsResult.data ?? []) as Array<{ clock_in: string; clock_out: string | null }>).some((row) =>
        overlaps(row.clock_in, row.clock_out)
      ) ||
      ((sessionsResult.data ?? []) as Array<{ clock_in: string; clock_out: string | null }>).some((row) =>
        overlaps(row.clock_in, row.clock_out)
      );

    if (clash) {
      return NextResponse.json(
        { error: "כבר קיים דיווח על השעות האלה." },
        { status: 409 }
      );
    }

    const { data: inserted, error: insertError } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .insert({
        user_id: profile.id,
        clock_in: startIso,
        clock_out: endIso,
        worked_minutes: workedMinutes,
        status: "pending_review",
        source: APP_ATTENDANCE_SOURCE,
        reported_by: profile.id,
        notes: notes || null,
      })
      .select("id,clock_in,clock_out,worked_minutes")
      .maybeSingle();

    if (insertError) {
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

    return NextResponse.json({ ok: true, session: inserted });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה בדיווח המשמרת.") }, { status: 500 });
  }
}
