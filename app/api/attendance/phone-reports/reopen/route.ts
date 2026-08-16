import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { PHONE_ATTENDANCE_TABLE } from "@/lib/attendance/phone-reports";

/**
 * Reopen a pending report — the worker clocked out and then carried straight on
 * working, so the SAME shift continues rather than a second one starting.
 *
 * Undoes the close: status back to `open`, clock-out and worked minutes cleared,
 * and the row leaves the approval queue and shows as present again. When it's
 * finally closed the whole stretch is one shift with one set of hours, which is
 * the point — a new report would split the day into two and be approved twice.
 *
 * Only from `pending_review`: once approved there's a real session behind it,
 * and that's an edit on the session, not a reopen of the report.
 */
export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as { report_id?: string };
    const reportId = typeof body.report_id === "string" ? body.report_id.trim() : "";
    if (!reportId) return NextResponse.json({ error: "חסר מזהה דיווח." }, { status: 400 });

    const { data: report, error: reportError } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .select("id,status")
      .eq("id", reportId)
      .maybeSingle();
    if (reportError) return NextResponse.json({ error: toHebrewError(reportError.message) }, { status: 400 });
    if (!report?.id) return NextResponse.json({ error: "הדיווח לא נמצא." }, { status: 404 });
    if (report.status !== "pending_review") {
      return NextResponse.json({ error: "אפשר להחזיר למשמרת פתוחה רק דיווח שממתין לאישור." }, { status: 409 });
    }

    // Guarded on status so two admins can't both reopen (or reopen one that was
    // approved a moment ago).
    const { data: updated, error: updateError } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .update({
        status: "open",
        clock_out: null,
        worked_minutes: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reportId)
      .eq("status", "pending_review")
      .select("id")
      .maybeSingle();
    if (updateError) {
      // Unique "one open shift per worker" index — he already has one running.
      if (updateError.code === "23505") {
        return NextResponse.json({ error: "כבר קיימת משמרת פתוחה לעובד זה." }, { status: 409 });
      }
      return NextResponse.json({ error: toHebrewError(updateError.message) }, { status: 400 });
    }
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
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה בפתיחת המשמרת מחדש.") }, { status: 500 });
  }
}
