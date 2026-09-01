import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const PHONE_ATTENDANCE_TABLE = "phone_attendance_reports";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Admin/office/worker actions on phone_attendance_reports, straight to
 * Supabase — mirrors the deleted /api/attendance/phone-reports/{edit,reopen,
 * reject,close,update-entry} routes exactly, including their guard conditions
 * and error messages. RLS already scopes each of these the same way those
 * routes' `requireRouteAccess({allowedRoles})` did:
 *  - "Staff manage phone attendance reports" — admin/office, unconditional ALL.
 *  - "phone_attendance_worker_close" — a worker may close/re-enter-times on
 *    any coworker's OPEN report (is_payroll_worker(user_id), not self-only —
 *    matches the app's own "whoever signs a colleague in notices the typo"
 *    design, see AttendanceLogDialog/AttendanceQueuePanel).
 * Audit logging is unaffected: phone_attendance_reports carries the generic
 * log_changes() DB trigger (confirmed 2026-09-01, see lib/audit.ts's
 * TRIGGER_AUDITED_TABLES fix), so it fires regardless of write path.
 */

/** Admin/office fix-up of a report still in the queue (status = pending_review). */
export async function updatePendingPhoneReport(
  reportId: string,
  clockIn: Date,
  clockOut: Date,
  notes: string
): Promise<Result> {
  const supabase = createSupabaseBrowserClient();
  const workedMinutes = Math.max(0, Math.round((clockOut.getTime() - clockIn.getTime()) / 60000));

  const { data: existing, error: fetchError } = await supabase
    .from(PHONE_ATTENDANCE_TABLE)
    .select("notes, notes_he")
    .eq("id", reportId)
    .eq("status", "pending_review")
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!existing) return { ok: false, error: "הדיווח כבר טופל." };
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

  if (error) return { ok: false, error: error.message };
  if (!updated?.id) return { ok: false, error: "הדיווח כבר טופל." };
  return { ok: true };
}

/** Undo a close — the same shift carries on rather than starting a second one. */
export async function reopenPhoneReport(reportId: string): Promise<Result> {
  const supabase = createSupabaseBrowserClient();
  const { data: report, error: reportError } = await supabase
    .from(PHONE_ATTENDANCE_TABLE)
    .select("id,status")
    .eq("id", reportId)
    .maybeSingle();
  if (reportError) return { ok: false, error: reportError.message };
  if (!report?.id) return { ok: false, error: "הדיווח לא נמצא." };
  if (report.status !== "pending_review") {
    return { ok: false, error: "אפשר להחזיר למשמרת פתוחה רק דיווח שממתין לאישור." };
  }

  const { data: updated, error } = await supabase
    .from(PHONE_ATTENDANCE_TABLE)
    .update({ status: "open", clock_out: null, worked_minutes: null, updated_at: new Date().toISOString() })
    .eq("id", reportId)
    .eq("status", "pending_review")
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "כבר קיימת משמרת פתוחה לעובד זה." };
    return { ok: false, error: error.message };
  }
  if (!updated?.id) return { ok: false, error: "הדיווח כבר טופל." };
  return { ok: true };
}

/** Reject a pending report — it never becomes a session. */
export async function rejectPhoneReport(reportId: string, reason: string): Promise<Result> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return { ok: false, error: "יש להתחבר מחדש." };
  const { data: reviewer } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();
  const reviewerId = (reviewer as { id?: string } | null)?.id;
  if (!reviewerId) return { ok: false, error: "לא ניתן לזהות את המשתמש." };

  const { data: rejected, error } = await supabase
    .from(PHONE_ATTENDANCE_TABLE)
    .update({
      status: "rejected",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      notes: reason ? `נדחה: ${reason}` : "נדחה",
    })
    .eq("id", reportId)
    .eq("status", "pending_review")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!rejected?.id) return { ok: false, error: "הדיווח כבר טופל." };
  return { ok: true };
}

/** Close an OPEN report (forgot to clock out, or an admin closing it for them). */
export async function closePhoneReport(reportId: string, clockOut: Date, notes: string): Promise<Result> {
  const supabase = createSupabaseBrowserClient();
  const { data: report, error: reportError } = await supabase
    .from(PHONE_ATTENDANCE_TABLE)
    .select("id,clock_in,status,notes")
    .eq("id", reportId)
    .maybeSingle();
  if (reportError) return { ok: false, error: reportError.message };
  if (!report?.id) return { ok: false, error: "הדיווח לא נמצא." };
  if (report.status !== "open") return { ok: false, error: "המשמרת אינה פתוחה." };
  if (clockOut <= new Date(report.clock_in as string)) {
    return { ok: false, error: "שעת היציאה חייבת להיות אחרי הכניסה." };
  }

  const worked = Math.max(0, Math.round((clockOut.getTime() - new Date(report.clock_in as string).getTime()) / 60000));
  const existingNotes = typeof report.notes === "string" ? report.notes.trim() : "";
  const mergedNotes = [existingNotes, notes].filter(Boolean).join(" · ") || null;

  const { data: updated, error } = await supabase
    .from(PHONE_ATTENDANCE_TABLE)
    .update({
      clock_out: clockOut.toISOString(),
      worked_minutes: worked,
      status: "pending_review",
      notes: mergedNotes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reportId)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated?.id) return { ok: false, error: "המשמרת כבר נסגרה." };
  return { ok: true };
}

/** Fix the clock-in time of an OPEN report. */
export async function updatePhoneReportClockIn(reportId: string, clockIn: Date): Promise<Result> {
  const supabase = createSupabaseBrowserClient();
  if (clockIn.getTime() > Date.now() + 60_000) {
    return { ok: false, error: "שעת הכניסה לא יכולה להיות בעתיד." };
  }
  const { data: report, error: reportError } = await supabase
    .from(PHONE_ATTENDANCE_TABLE)
    .select("id,status")
    .eq("id", reportId)
    .maybeSingle();
  if (reportError) return { ok: false, error: reportError.message };
  if (!report?.id) return { ok: false, error: "הדיווח לא נמצא." };
  if (report.status !== "open") return { ok: false, error: "ניתן לעדכן שעת כניסה רק למשמרת פתוחה." };

  const { data: updated, error } = await supabase
    .from(PHONE_ATTENDANCE_TABLE)
    .update({ clock_in: clockIn.toISOString(), updated_at: new Date().toISOString() })
    .eq("id", reportId)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated?.id) return { ok: false, error: "המשמרת כבר אינה פתוחה." };
  return { ok: true };
}
