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
import { addMinutes, getActiveSalaryAgreementForDate, minutesBetween, type SalaryAgreementRow, WORK_SESSIONS_TABLE } from "@/lib/payroll";
import { PHONE_ATTENDANCE_TABLE } from "@/lib/attendance/phone-reports";

/**
 * Approve a pending phone-attendance report → create the real attendance_sessions row(s).
 *
 * The admin classifies the shift to one or more business domains. With a single part the whole
 * shift becomes one session; with several parts the shift's time range is sliced into contiguous
 * sessions (each with its own domain / project / property / customer-billing), same idea as the
 * session-split flow. We claim the report FIRST (guarded on pending_review) so two admins can't
 * both approve it; if session creation then fails we revert and delete anything inserted.
 */

type PartPayload = {
  business_domain?: string | null;
  project_id?: string | null;
  property_id?: string | null;
  minutes?: number | string | null;
  is_billable_to_customer?: boolean | null;
  bill_to_customer_amount?: number | string | null;
};

type ApprovePayload = { report_id?: string; parts?: PartPayload[] };

type NormalizedPart = {
  minutes: number;
  domain: string;
  projectId: string | null;
  propertyId: string | null;
  billable: boolean;
  billAmount: number | null;
};

function toNonNegative(value: unknown) {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as ApprovePayload;
    const reportId = typeof body.report_id === "string" ? body.report_id.trim() : "";
    const rawParts = Array.isArray(body.parts) ? body.parts : [];

    if (!reportId) return NextResponse.json({ error: "חסר מזהה דיווח." }, { status: 400 });
    if (rawParts.length < 1) return NextResponse.json({ error: "יש לבחור לפחות תחום אחד." }, { status: 400 });

    const { data: report, error: reportError } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .select("id,user_id,clock_in,clock_out,status,notes")
      .eq("id", reportId)
      .maybeSingle();

    if (reportError) return NextResponse.json({ error: toHebrewError(reportError.message) }, { status: 400 });
    if (!report?.id) return NextResponse.json({ error: "הדיווח לא נמצא." }, { status: 404 });
    if (report.status !== "pending_review") return NextResponse.json({ error: "הדיווח כבר טופל." }, { status: 409 });

    const clockIn = report.clock_in as string;
    const clockOut = report.clock_out as string;
    const reportNotes = (typeof report.notes === "string" && report.notes.trim() ? report.notes.trim() : "דיווח טלפוני").slice(0, 500);
    const totalMinutes = minutesBetween(clockIn, clockOut);
    if (totalMinutes <= 0) return NextResponse.json({ error: "טווח הזמן של הדיווח אינו תקין." }, { status: 400 });
    if (rawParts.length > totalMinutes) {
      return NextResponse.json({ error: "לא ניתן לפצל ליותר חלקים ממספר הדקות במשמרת." }, { status: 400 });
    }

    // Worker must still exist, be active, and log sessions.
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

    // ---- Normalize + validate the parts, allocating time (last part = the remainder). ----
    const parts: NormalizedPart[] = [];
    let consumed = 0;
    for (let index = 0; index < rawParts.length; index += 1) {
      const raw = rawParts[index];
      const isLast = index === rawParts.length - 1;
      const domain = isExpenseBusinessDomain(raw.business_domain) ? raw.business_domain : null;
      const projectId = typeof raw.project_id === "string" && raw.project_id.trim() ? raw.project_id.trim() : null;
      const propertyId = typeof raw.property_id === "string" && raw.property_id.trim() ? raw.property_id.trim() : null;
      const billable = domain === "logistics_projects" && raw.is_billable_to_customer === true;
      const billAmount = billable ? toNonNegative(raw.bill_to_customer_amount) : null;

      if (!domain) return NextResponse.json({ error: `יש לבחור תחום עסקי בחלק ${index + 1}.` }, { status: 400 });
      if (domain === "logistics_projects" && !projectId) return NextResponse.json({ error: `יש לבחור פרויקט בחלק ${index + 1}.` }, { status: 400 });
      if (domain === "property_management" && !propertyId) return NextResponse.json({ error: `יש לבחור נכס בחלק ${index + 1}.` }, { status: 400 });
      if (billable && (billAmount === null || billAmount <= 0)) return NextResponse.json({ error: `יש להזין סכום חיוב ללקוח תקין בחלק ${index + 1}.` }, { status: 400 });

      let minutes: number;
      if (rawParts.length === 1) {
        minutes = totalMinutes;
      } else if (isLast) {
        minutes = totalMinutes - consumed;
      } else {
        minutes = Math.round(Number(toNonNegative(raw.minutes)));
        if (!Number.isFinite(minutes) || minutes <= 0) return NextResponse.json({ error: `משך לא תקין בחלק ${index + 1}.` }, { status: 400 });
        if (consumed + minutes >= totalMinutes) return NextResponse.json({ error: "סכום החלקים גדול או שווה למשך המשמרת — לא נשאר זמן לחלק האחרון." }, { status: 400 });
      }
      consumed += minutes;
      parts.push({
        minutes,
        domain,
        projectId: domain === "logistics_projects" ? projectId : null,
        propertyId: domain === "property_management" ? propertyId : null,
        billable,
        billAmount: billable ? billAmount : null,
      });
    }
    if (consumed !== totalMinutes) return NextResponse.json({ error: "סכום החלקים חייב להיות שווה למשך המשמרת." }, { status: 400 });

    // Validate referenced projects/properties exist (before claiming the report).
    const projectIds = Array.from(new Set(parts.map((p) => p.projectId).filter(Boolean))) as string[];
    const propertyIds = Array.from(new Set(parts.map((p) => p.propertyId).filter(Boolean))) as string[];
    if (projectIds.length) {
      const { data: found } = await supabase.from("projects").select("id").in("id", projectIds);
      if ((found?.length ?? 0) !== projectIds.length) return NextResponse.json({ error: "אחד הפרויקטים שנבחרו לא נמצא." }, { status: 404 });
    }
    if (propertyIds.length) {
      const { data: found } = await supabase.from("properties").select("id").in("id", propertyIds);
      if ((found?.length ?? 0) !== propertyIds.length) return NextResponse.json({ error: "אחד הנכסים שנבחרו לא נמצא." }, { status: 404 });
    }

    // Claim first — guards against a concurrent second approval creating duplicate sessions.
    const now = new Date().toISOString();
    const { data: claimed, error: claimError } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .update({ status: "approved", reviewed_by: profile.id, reviewed_at: now, updated_at: now })
      .eq("id", reportId)
      .eq("status", "pending_review")
      .select("id")
      .maybeSingle();
    if (claimError) return NextResponse.json({ error: toHebrewError(claimError.message) }, { status: 400 });
    if (!claimed?.id) return NextResponse.json({ error: "הדיווח כבר טופל." }, { status: 409 });

    const revertClaim = async () => {
      await supabase.from(PHONE_ATTENDANCE_TABLE).update({ status: "pending_review", reviewed_by: null, reviewed_at: null }).eq("id", reportId);
    };

    // Slice the shift into contiguous sessions.
    let cursor = clockIn;
    const rows = parts.map((part) => {
      const end = addMinutes(cursor, part.minutes);
      const range = {
        user_id: report.user_id,
        clock_in: cursor,
        clock_out: (end ?? new Date(clockOut)).toISOString(),
        worked_minutes: part.minutes,
        labor_cost: null as number | null, // recalculated from the agreement below
        is_billable_to_customer: part.billable,
        bill_to_customer_amount: part.billAmount,
        billing_status: part.billable ? "billable" : "not_billable",
        // Carry the report's own note through — the write-up made at CLOCK-OUT
        // (by the worker, or by whoever closed the shift for him). Approving is a
        // classification step, so nothing is typed here. Falls back to the origin
        // tag, which is all the row said before there was anywhere to write.
        notes: reportNotes,
        business_domain: part.domain,
        project_id: part.projectId,
        property_id: part.propertyId,
      };
      cursor = range.clock_out;
      return range;
    });

    const { data: inserted, error: insertError } = await supabase.from(WORK_SESSIONS_TABLE).insert(rows).select("id");
    if (insertError || !inserted?.length) {
      await revertClaim();
      return NextResponse.json({ error: toHebrewError(insertError?.message ?? "יצירת המשמרת נכשלה.") }, { status: 400 });
    }
    const sessionIds = inserted.map((row) => row.id as string);

    await supabase.from(PHONE_ATTENDANCE_TABLE).update({ attendance_session_id: sessionIds[0] }).eq("id", reportId);

    // Price the sessions from the worker's salary agreement (mirrors sessions/create).
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

    await logAuditEvent({
      supabase,
      tableName: PHONE_ATTENDANCE_TABLE,
      recordId: reportId,
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ ok: true, session_ids: sessionIds });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה באישור הדיווח.") }, { status: 500 });
  }
}
