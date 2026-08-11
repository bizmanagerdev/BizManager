import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { minutesBetween } from "@/lib/payroll";
import { PHONE_ATTENDANCE_TABLE } from "@/lib/attendance/phone-reports";

/**
 * Close an OPEN phone-attendance report from the queue — for a worker who's still clocked in (forgot
 * to clock out, or the admin is closing their shift). Sets the clock-out (given time, or now) and
 * moves it to pending_review so the boss can classify + approve it like any other report.
 */

type Body = { report_id?: string; clock_out?: string | null };

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office", "worker"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as Body;
    const reportId = typeof body.report_id === "string" ? body.report_id.trim() : "";
    const clockOutRaw = typeof body.clock_out === "string" ? body.clock_out.trim() : "";
    if (!reportId) return NextResponse.json({ error: "חסר מזהה דיווח." }, { status: 400 });

    const { data: report, error: reportError } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .select("id,clock_in,status")
      .eq("id", reportId)
      .maybeSingle();
    if (reportError) return NextResponse.json({ error: toHebrewError(reportError.message) }, { status: 400 });
    if (!report?.id) return NextResponse.json({ error: "הדיווח לא נמצא." }, { status: 404 });
    if (report.status !== "open") return NextResponse.json({ error: "המשמרת אינה פתוחה." }, { status: 409 });

    const clockOut = clockOutRaw ? new Date(clockOutRaw) : new Date();
    if (Number.isNaN(clockOut.getTime())) return NextResponse.json({ error: "שעת היציאה אינה תקינה." }, { status: 400 });
    if (clockOut <= new Date(report.clock_in as string)) {
      return NextResponse.json({ error: "שעת היציאה חייבת להיות אחרי הכניסה." }, { status: 400 });
    }

    const worked = minutesBetween(report.clock_in as string, clockOut);
    const { data: updated, error: updateError } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .update({ clock_out: clockOut.toISOString(), worked_minutes: worked, status: "pending_review", updated_at: new Date().toISOString() })
      .eq("id", reportId)
      .eq("status", "open")
      .select("id")
      .maybeSingle();
    if (updateError) return NextResponse.json({ error: toHebrewError(updateError.message) }, { status: 400 });
    if (!updated?.id) return NextResponse.json({ error: "המשמרת כבר נסגרה." }, { status: 409 });

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
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה בסגירת המשמרת.") }, { status: 500 });
  }
}
