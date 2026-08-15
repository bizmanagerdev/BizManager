import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { PHONE_ATTENDANCE_TABLE } from "@/lib/attendance/phone-reports";
import { parseSelfReportedTime } from "@/lib/attendance/my-shift";

/**
 * Correct an already-APPROVED shift.
 *
 * The session is withdrawn from payroll and the corrected times are filed as a
 * fresh pending_review report, so the boss re-approves it like any other. Both
 * halves are one transaction inside request_attendance_session_edit() — a
 * SECURITY DEFINER function, because deleting a payroll row is precisely what
 * the caller's own policies forbid. Its guards (yours / not paid / not in a
 * closed period) are the real gate; this route only shapes the request and
 * turns the function's errors into Hebrew.
 */

/** Postgres error hints are already user-facing Hebrew; map the rest by code. */
const REASONS: Record<string, string> = {
  session_not_found: "המשמרת לא נמצאה.",
  forbidden: "אפשר לתקן רק משמרת שלך.",
  invalid_range: "שעת הסיום חייבת להיות אחרי שעת ההתחלה.",
  future_time: "לא ניתן לדווח שעות בעתיד.",
  session_paid: "המשמרת כבר שולמה — פנה למנהל.",
  period_locked: "תקופת השכר של המשמרת נעולה.",
  not_authenticated: "לא ניתן לזהות את המשתמש.",
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as {
      session_id?: string;
      clock_in?: string;
      clock_out?: string;
      notes?: string | null;
    };
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    if (!sessionId) return NextResponse.json({ error: "חסר מזהה משמרת." }, { status: 400 });

    const now = new Date();
    const start = parseSelfReportedTime(body.clock_in, "שעת התחלה", now);
    if ("error" in start) return NextResponse.json({ error: start.error }, { status: 400 });
    // A correction may reach further back than a fresh report — you're fixing a
    // shift that's already been approved, which is by definition in the past —
    // so only the "not in the future" half of the rule applies to the end time.
    const endRaw = typeof body.clock_out === "string" ? body.clock_out.trim() : "";
    const end = endRaw ? new Date(endRaw) : null;
    if (!end || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: "שעת הסיום אינה תקינה." }, { status: 400 });
    }
    if (end <= start.date) {
      return NextResponse.json({ error: "שעת הסיום חייבת להיות אחרי שעת ההתחלה." }, { status: 400 });
    }

    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";

    const { data, error } = await supabase.rpc("request_attendance_session_edit", {
      p_session_id: sessionId,
      p_clock_in: start.date.toISOString(),
      p_clock_out: end.toISOString(),
      p_notes: notes || null,
    });

    if (error) {
      // The function raises named exceptions; its `hint` is already Hebrew.
      const reason = REASONS[error.message] ?? (error as { hint?: string }).hint ?? null;
      return NextResponse.json(
        { error: reason ?? toHebrewError(error.message, "עדכון המשמרת נכשל.") },
        { status: reason ? 409 : 400 }
      );
    }

    const reportId = typeof data === "string" ? data : null;
    if (reportId) {
      await logAuditEvent({
        supabase,
        tableName: PHONE_ATTENDANCE_TABLE,
        recordId: reportId,
        action: "create",
        changedBy: profile.id,
        userRole: profile.role,
      });
    }

    return NextResponse.json({ ok: true, report_id: reportId });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה בעדכון המשמרת.") }, { status: 500 });
  }
}
