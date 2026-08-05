import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import { recalculateUserSessionCostsFromRules, regenerateEditablePayslipsForUsers } from "@/lib/payroll-center";
import {
  normalizePayrollWorkerType,
  payrollWorkerTypeAllowsSessions,
  payrollWorkerTypeGeneratesPayslips,
} from "@/lib/payroll-worker-type";
import { getActiveSalaryAgreementForDate, minutesBetween, type SalaryAgreementRow, WORK_SESSIONS_TABLE } from "@/lib/payroll";
import { PHONE_ATTENDANCE_TABLE } from "@/lib/attendance/phone-reports";

/**
 * Approve a pending phone-attendance report → create the real attendance_sessions row.
 *
 * The admin supplies the business_domain (and project/property where the domain needs one) and may
 * correct the clock times. We flip the report to `approved` FIRST (guarded on pending_review) so two
 * admins can't both approve it into two sessions; if session creation then fails we revert.
 */

type ApprovePayload = {
  report_id?: string;
  business_domain?: string | null;
  project_id?: string | null;
  property_id?: string | null;
  clock_in?: string | null;
  clock_out?: string | null;
  notes?: string | null;
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as ApprovePayload;
    const reportId = typeof body.report_id === "string" ? body.report_id.trim() : "";
    const businessDomain = isExpenseBusinessDomain(body.business_domain) ? body.business_domain : null;
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const propertyId = typeof body.property_id === "string" ? body.property_id.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";

    if (!reportId) return NextResponse.json({ error: "חסר מזהה דיווח." }, { status: 400 });
    if (!businessDomain) return NextResponse.json({ error: "יש לבחור תחום עסקי." }, { status: 400 });
    if (businessDomain === "logistics_projects" && !projectId) {
      return NextResponse.json({ error: "יש לבחור פרויקט." }, { status: 400 });
    }
    if (businessDomain === "property_management" && !propertyId) {
      return NextResponse.json({ error: "יש לבחור נכס." }, { status: 400 });
    }

    const { data: report, error: reportError } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .select("id,user_id,clock_in,clock_out,status")
      .eq("id", reportId)
      .maybeSingle();

    if (reportError) return NextResponse.json({ error: toHebrewError(reportError.message) }, { status: 400 });
    if (!report?.id) return NextResponse.json({ error: "הדיווח לא נמצא." }, { status: 404 });
    if (report.status !== "pending_review") {
      return NextResponse.json({ error: "הדיווח כבר טופל." }, { status: 409 });
    }

    // Admin may correct the times; default to what the phone recorded.
    const clockIn = (typeof body.clock_in === "string" && body.clock_in.trim() ? body.clock_in.trim() : report.clock_in) as string;
    const clockOut = (typeof body.clock_out === "string" && body.clock_out.trim() ? body.clock_out.trim() : report.clock_out) as string;
    if (!clockIn || !clockOut || new Date(clockOut) <= new Date(clockIn)) {
      return NextResponse.json({ error: "שעת הסיום חייבת להיות אחרי שעת ההתחלה." }, { status: 400 });
    }

    // Validate the worker still exists, is active, and logs sessions.
    const { data: worker, error: workerError } = await supabase
      .from("users")
      .select("id,active,payroll_worker_type,pay_tracking_mode")
      .eq("id", report.user_id)
      .maybeSingle();
    if (workerError) return NextResponse.json({ error: toHebrewError(workerError.message) }, { status: 400 });
    if (!worker?.id) return NextResponse.json({ error: "העובד לא נמצא." }, { status: 404 });
    if (worker.active === false) return NextResponse.json({ error: "העובד אינו פעיל." }, { status: 400 });

    const workerType = normalizePayrollWorkerType(worker.payroll_worker_type, worker.pay_tracking_mode);
    if (!payrollWorkerTypeAllowsSessions(workerType)) {
      return NextResponse.json({ error: "סוג העובד הזה לא מתעד משמרות." }, { status: 409 });
    }

    if (businessDomain === "logistics_projects") {
      const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
      if (!project) return NextResponse.json({ error: "הפרויקט שנבחר לא נמצא." }, { status: 404 });
    }
    if (businessDomain === "property_management") {
      const { data: property } = await supabase.from("properties").select("id").eq("id", propertyId).maybeSingle();
      if (!property) return NextResponse.json({ error: "הנכס שנבחר לא נמצא." }, { status: 404 });
    }

    // Claim the report first so a concurrent approval can't create a second session.
    const { data: claimed, error: claimError } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .update({ status: "approved", reviewed_by: profile.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", reportId)
      .eq("status", "pending_review")
      .select("id")
      .maybeSingle();

    if (claimError) return NextResponse.json({ error: toHebrewError(claimError.message) }, { status: 400 });
    if (!claimed?.id) return NextResponse.json({ error: "הדיווח כבר טופל." }, { status: 409 });

    const revertClaim = async () => {
      await supabase
        .from(PHONE_ATTENDANCE_TABLE)
        .update({ status: "pending_review", reviewed_by: null, reviewed_at: null })
        .eq("id", reportId);
    };

    const workedMinutes = minutesBetween(clockIn, clockOut);
    const sessionNotes = ["דיווח טלפוני", notes].filter(Boolean).join(" — ");

    const { data: session, error: insertError } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .insert({
        user_id: report.user_id,
        clock_in: clockIn,
        clock_out: clockOut,
        worked_minutes: workedMinutes,
        labor_cost: null, // recalculated from the worker's agreement below
        is_billable_to_customer: false,
        bill_to_customer_amount: null,
        billing_status: "not_billable",
        notes: sessionNotes,
        business_domain: businessDomain,
        project_id: businessDomain === "logistics_projects" ? projectId : null,
        property_id: businessDomain === "property_management" ? propertyId : null,
      })
      .select("id")
      .maybeSingle();

    if (insertError || !session?.id) {
      await revertClaim();
      return NextResponse.json({ error: toHebrewError(insertError?.message ?? "יצירת המשמרת נכשלה.") }, { status: 400 });
    }

    // Link the report to the session it produced.
    await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .update({ attendance_session_id: session.id, clock_in: clockIn, clock_out: clockOut })
      .eq("id", reportId);

    // Price the session from the worker's salary agreement (mirrors sessions/create).
    const { data: agreements } = await supabase
      .from("salary_agreements")
      .select("id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours")
      .eq("user_id", report.user_id)
      .order("valid_from", { ascending: false });

    const activeAgreement = getActiveSalaryAgreementForDate((agreements ?? []) as SalaryAgreementRow[], new Date(clockIn));
    if (activeAgreement) {
      await recalculateUserSessionCostsFromRules(supabase, report.user_id, {
        fromDate: clockIn.slice(0, 10),
        regeneratePayslips: payrollWorkerTypeGeneratesPayslips(workerType),
      });
    } else if (payrollWorkerTypeGeneratesPayslips(workerType)) {
      await regenerateEditablePayslipsForUsers(supabase, [report.user_id]);
    }

    // attendance_sessions is DB-trigger-audited; phone_attendance_reports is not, so log its update.
    await logAuditEvent({
      supabase,
      tableName: PHONE_ATTENDANCE_TABLE,
      recordId: reportId,
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ ok: true, session_id: session.id });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה באישור הדיווח.") }, { status: 500 });
  }
}
