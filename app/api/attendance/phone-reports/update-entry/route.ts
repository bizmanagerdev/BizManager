import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { PHONE_ATTENDANCE_TABLE } from "@/lib/attendance/phone-reports";

/**
 * Fix the entry (clock-in) time of an OPEN phone-attendance report — e.g. a worker clocked in but
 * their shift actually started earlier. Only allowed while the shift is still open; once it's
 * closed/approved the times are edited through the approval flow instead.
 *
 * Open to workers for the same reason the rest of דיווח נוכחות is: whoever signs a colleague in
 * is the one who notices he typed 09:00 for an 08:00 start. The shift stays open and unapproved,
 * so the correction still has to pass the boss.
 */

type Body = { report_id?: string; clock_in?: string };

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office", "worker"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as Body;
    const reportId = typeof body.report_id === "string" ? body.report_id.trim() : "";
    const clockInRaw = typeof body.clock_in === "string" ? body.clock_in.trim() : "";
    if (!reportId) return NextResponse.json({ error: "חסר מזהה דיווח." }, { status: 400 });
    if (!clockInRaw) return NextResponse.json({ error: "יש להזין שעת כניסה." }, { status: 400 });

    const clockIn = new Date(clockInRaw);
    if (Number.isNaN(clockIn.getTime())) return NextResponse.json({ error: "שעת הכניסה אינה תקינה." }, { status: 400 });
    // An open shift can't start in the future (small tolerance for clock skew).
    if (clockIn.getTime() > Date.now() + 60_000) {
      return NextResponse.json({ error: "שעת הכניסה לא יכולה להיות בעתיד." }, { status: 400 });
    }

    const { data: report, error: reportError } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .select("id,status")
      .eq("id", reportId)
      .maybeSingle();
    if (reportError) return NextResponse.json({ error: toHebrewError(reportError.message) }, { status: 400 });
    if (!report?.id) return NextResponse.json({ error: "הדיווח לא נמצא." }, { status: 404 });
    if (report.status !== "open") return NextResponse.json({ error: "ניתן לעדכן שעת כניסה רק למשמרת פתוחה." }, { status: 409 });

    const { data: updated, error: updateError } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .update({ clock_in: clockIn.toISOString(), updated_at: new Date().toISOString() })
      .eq("id", reportId)
      .eq("status", "open")
      .select("id")
      .maybeSingle();
    if (updateError) return NextResponse.json({ error: toHebrewError(updateError.message) }, { status: 400 });
    if (!updated?.id) return NextResponse.json({ error: "המשמרת כבר אינה פתוחה." }, { status: 409 });

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
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה בעדכון שעת הכניסה.") }, { status: 500 });
  }
}
