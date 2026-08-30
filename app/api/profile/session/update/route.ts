import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import { recalculateUserSessionCostsFromRules } from "@/lib/payroll-center";
import { normalizePayrollWorkerType, payrollWorkerTypeAllowsSessions } from "@/lib/payroll-worker-type";
import {
  getActiveSalaryAgreementForDate,
  minutesBetween,
  type SalaryAgreementRow,
  WORK_SESSIONS_TABLE,
} from "@/lib/payroll";

type UpdateSessionPayload = {
  session_id?: string;
  user_id?: string | null;
  business_domain?: string | null;
  project_id?: string | null;
  property_id?: string | null;
  notes?: string | null;
  clock_in?: string | null;
  clock_out?: string | null;
  labor_cost?: number | string | null;
  recalculate_labor_cost?: boolean | null;
  is_billable_to_customer?: boolean | null;
  bill_to_customer_amount?: number | string | null;
  billing_status?: string | null;
};

function toOptionalNonNegativeNumber(value: unknown) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function overlaps(start: string, end: string | null, otherStart: string, otherEnd: string | null) {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Number.POSITIVE_INFINITY;
  const otherStartMs = new Date(otherStart).getTime();
  const otherEndMs = otherEnd ? new Date(otherEnd).getTime() : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(startMs) || !Number.isFinite(otherStartMs)) return false;
  return startMs < otherEndMs && otherStartMs < endMs;
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as UpdateSessionPayload;
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    const selectedUserId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const businessDomain = isExpenseBusinessDomain(body.business_domain)
      ? body.business_domain
      : null;
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const propertyId = typeof body.property_id === "string" ? body.property_id.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    const clockIn = typeof body.clock_in === "string" ? body.clock_in.trim() : "";
    const clockOutInput = typeof body.clock_out === "string" ? body.clock_out.trim() : "";
    const clockOut = clockOutInput || null;
    const requestedLaborCost = toOptionalNonNegativeNumber(body.labor_cost);
    const recalculateLaborCost = body.recalculate_labor_cost === true;
    const isBillableToCustomer = body.is_billable_to_customer === true;
    const billToCustomerAmount = toOptionalNonNegativeNumber(body.bill_to_customer_amount);
    const billingStatus =
      typeof body.billing_status === "string" && body.billing_status.trim()
        ? body.billing_status.trim()
        : isBillableToCustomer
          ? "billable"
          : "not_billable";

    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
    }
    if (!businessDomain) {
      return NextResponse.json({ error: "Missing or invalid business_domain" }, { status: 400 });
    }
    if (!selectedUserId) {
      return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
    }
    if (selectedUserId !== profile.id && profile.role !== "admin" && profile.role !== "office") {
      return NextResponse.json({ error: "לא ניתן לעדכן משמרת לעובד אחר." }, { status: 403 });
    }
    if (!clockIn) {
      return NextResponse.json({ error: "יש להזין שעת התחלה." }, { status: 400 });
    }
    if (isBillableToCustomer && (billToCustomerAmount === null || billToCustomerAmount <= 0)) {
      return NextResponse.json(
        { error: "Missing or invalid bill_to_customer_amount" },
        { status: 400 }
      );
    }
    if (businessDomain === "logistics_projects" && !projectId) {
      return NextResponse.json({ error: "יש לבחור פרויקט לתחום פרויקטים." }, { status: 400 });
    }
    if (businessDomain === "property_management" && !propertyId) {
      return NextResponse.json({ error: "יש לבחור נכס לתחום ניהול נכסים." }, { status: 400 });
    }

    const parsedClockIn = new Date(clockIn);
    if (Number.isNaN(parsedClockIn.getTime())) {
      return NextResponse.json({ error: "שעת ההתחלה לא תקינה." }, { status: 400 });
    }
    if (clockOut) {
      const parsedClockOut = new Date(clockOut);
      if (Number.isNaN(parsedClockOut.getTime()) || parsedClockOut <= parsedClockIn) {
        return NextResponse.json({ error: "שעת הסיום חייבת להיות אחרי שעת ההתחלה." }, { status: 400 });
      }
    }

    const { data: session, error: sessionError } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .select("id,user_id,project_id,clock_in,labor_cost")
      .eq("id", sessionId)
      .eq("user_id", selectedUserId)
      .maybeSingle();

    if (sessionError) {
      return NextResponse.json({ error: toHebrewError(sessionError.message) }, { status: 400 });
    }
    if (!session) {
      return NextResponse.json({ error: "המשמרת לא נמצאה." }, { status: 404 });
    }

    const { data: selectedUser, error: selectedUserError } = await supabase
      .from("users")
      .select("id,payroll_worker_type,pay_tracking_mode")
      .eq("id", selectedUserId)
      .maybeSingle();

    if (selectedUserError) {
      return NextResponse.json({ error: toHebrewError(selectedUserError.message) }, { status: 400 });
    }
    if (!selectedUser?.id) {
      return NextResponse.json({ error: "העובד שנבחר לא נמצא." }, { status: 404 });
    }
    const workerType = normalizePayrollWorkerType(selectedUser.payroll_worker_type, selectedUser.pay_tracking_mode);
    if (!payrollWorkerTypeAllowsSessions(workerType)) {
      return NextResponse.json({ error: "סוג העובד הזה אינו מתעד משמרות." }, { status: 409 });
    }

    if (businessDomain === "logistics_projects") {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .maybeSingle();
      if (projectError) return NextResponse.json({ error: toHebrewError(projectError.message) }, { status: 400 });
      if (!project) return NextResponse.json({ error: "הפרויקט שנבחר לא נמצא." }, { status: 404 });
    }

    if (businessDomain === "property_management") {
      const { data: property, error: propertyError } = await supabase
        .from("properties")
        .select("id")
        .eq("id", propertyId)
        .maybeSingle();
      if (propertyError) return NextResponse.json({ error: toHebrewError(propertyError.message) }, { status: 400 });
      if (!property) return NextResponse.json({ error: "הנכס שנבחר לא נמצא." }, { status: 404 });
    }

    const { data: siblingSessions, error: siblingSessionsError } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .select("id,clock_in,clock_out")
      .eq("user_id", selectedUserId)
      .neq("id", sessionId)
      .order("clock_in", { ascending: false })
      .limit(500);

    if (siblingSessionsError) {
      return NextResponse.json({ error: toHebrewError(siblingSessionsError.message) }, { status: 400 });
    }

    const { data: salaryAgreements, error: salaryAgreementsError } = await supabase
      .from("salary_agreements")
      .select("id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours")
      .eq("user_id", selectedUserId)
      .order("valid_from", { ascending: false });

    if (salaryAgreementsError) {
      return NextResponse.json({ error: toHebrewError(salaryAgreementsError.message) }, { status: 400 });
    }

    if (workerType !== "session_only") {
      const overlapSession = (siblingSessions ?? []).find((row) => {
        if (typeof row.clock_in !== "string") return false;
        const siblingClockOut = typeof row.clock_out === "string" ? row.clock_out : null;
        return overlaps(clockIn, clockOut, row.clock_in, siblingClockOut);
      });

      if (overlapSession) {
        return NextResponse.json({ error: "המשמרת חופפת למשמרת אחרת." }, { status: 400 });
      }
    }

    if (!clockOut) {
      const anotherOpenSession = (siblingSessions ?? []).find((row) => row.clock_out == null);
      if (anotherOpenSession) {
        return NextResponse.json(
          { error: "יכולה להיות רק משמרת פתוחה אחת למשתמש בכל זמן." },
          { status: 400 }
        );
      }
    }

    const activeAgreement = getActiveSalaryAgreementForDate(
      (salaryAgreements ?? []) as SalaryAgreementRow[],
      new Date(clockIn)
    );
    const canRecalculateLaborCost = recalculateLaborCost && Boolean(activeAgreement);

    const workedMinutes = clockOut ? minutesBetween(clockIn, clockOut) : null;
    let resolvedLaborCost: number | null = requestedLaborCost;

    if (resolvedLaborCost === null) {
      resolvedLaborCost =
        typeof session.labor_cost === "number" || typeof session.labor_cost === "string"
          ? Number(session.labor_cost)
          : null;
    }
    if (canRecalculateLaborCost) {
      resolvedLaborCost = null;
    }

    const previousUserId = session.user_id;
    const previousClockIn = typeof session.clock_in === "string" ? session.clock_in : clockIn;

    const { data, error } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .update({
        user_id: selectedUserId,
        clock_in: clockIn,
        clock_out: clockOut,
        worked_minutes: workedMinutes,
        labor_cost: resolvedLaborCost,
        is_billable_to_customer: isBillableToCustomer,
        bill_to_customer_amount: isBillableToCustomer ? billToCustomerAmount : null,
        billing_status: billingStatus,
        notes: notes || null,
        business_domain: businessDomain,
        project_id: businessDomain === "logistics_projects" ? projectId : null,
        property_id: businessDomain === "property_management" ? propertyId : null,
      })
      .eq("id", sessionId)
      .select("id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    }

    if (canRecalculateLaborCost && requestedLaborCost === null && clockOut) {
      await recalculateUserSessionCostsFromRules(supabase, selectedUserId, {
        fromDate: clockIn.slice(0, 10),
        regeneratePayslips: false,
      });
      if (previousUserId && previousUserId !== selectedUserId) {
        await recalculateUserSessionCostsFromRules(supabase, previousUserId, {
          fromDate: previousClockIn.slice(0, 10),
          regeneratePayslips: false,
        });
      } else if (previousClockIn.slice(0, 10) !== clockIn.slice(0, 10)) {
        await recalculateUserSessionCostsFromRules(supabase, previousUserId, {
          fromDate: previousClockIn.slice(0, 10),
          regeneratePayslips: false,
        });
      }
      const refreshed = await supabase
        .from(WORK_SESSIONS_TABLE)
        .select("id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id")
        .eq("id", sessionId)
        .maybeSingle();
      if (refreshed.error) {
        return NextResponse.json({ error: toHebrewError(refreshed.error.message) }, { status: 400 });
      }
      return NextResponse.json({ session: refreshed.data });
    }

    return NextResponse.json({ session: data });
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
