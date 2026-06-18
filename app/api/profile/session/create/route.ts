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

type CreateSessionPayload = {
  user_id?: string | null;
  business_domain?: string | null;
  project_id?: string | null;
  property_id?: string | null;
  notes?: string | null;
  clock_in?: string | null;
  clock_out?: string | null;
  labor_cost?: number | string | null;
  is_billable_to_customer?: boolean | null;
  bill_to_customer_amount?: number | string | null;
  billing_status?: string | null;
};

function toPositiveNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function overlaps(start: string, end: string, otherStart: string, otherEnd: string | null) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const otherStartMs = new Date(otherStart).getTime();
  const otherEndMs = otherEnd ? new Date(otherEnd).getTime() : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(otherStartMs)) return false;
  return startMs < otherEndMs && otherStartMs < endMs;
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;

    const { profile } = access.value;
    const body = (await req.json().catch(() => ({}))) as CreateSessionPayload;
    const businessDomain = isExpenseBusinessDomain(body.business_domain)
      ? body.business_domain
      : null;
    const selectedUserId =
      typeof body.user_id === "string" && body.user_id.trim()
        ? body.user_id.trim()
        : profile.id;
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const propertyId = typeof body.property_id === "string" ? body.property_id.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    const clockIn = typeof body.clock_in === "string" ? body.clock_in.trim() : "";
    const clockOut = typeof body.clock_out === "string" ? body.clock_out.trim() : "";
    const laborCost = toPositiveNumber(body.labor_cost);
    const isBillableToCustomer = body.is_billable_to_customer === true;
    const billToCustomerAmount = toPositiveNumber(body.bill_to_customer_amount);
    const billingStatus =
      typeof body.billing_status === "string" && body.billing_status.trim()
        ? body.billing_status.trim()
        : isBillableToCustomer
          ? "billable"
          : "not_billable";

    if (!businessDomain) {
      return NextResponse.json({ error: "Missing or invalid business_domain" }, { status: 400 });
    }
    if (!selectedUserId) {
      return NextResponse.json({ error: "יש לבחור עובד." }, { status: 400 });
    }
    // Workers may only log their own shifts; admin/office can log a shift for any
    // worker (e.g. the "add employee wage" flow on the project page). This mirrors
    // the same gate in profile/session/update.
    if (selectedUserId !== profile.id && profile.role !== "admin" && profile.role !== "office") {
      return NextResponse.json({ error: "לא ניתן להוסיף משמרת לעובד אחר." }, { status: 403 });
    }
    if (!clockIn || !clockOut) {
      return NextResponse.json({ error: "יש להזין שעת התחלה ושעת סיום." }, { status: 400 });
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
    const parsedClockOut = new Date(clockOut);
    if (
      Number.isNaN(parsedClockIn.getTime()) ||
      Number.isNaN(parsedClockOut.getTime()) ||
      parsedClockOut <= parsedClockIn
    ) {
      return NextResponse.json({ error: "שעת הסיום חייבת להיות אחרי שעת ההתחלה." }, { status: 400 });
    }

    const { supabase } = access.value;

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

    const { data: existingSessions, error: existingSessionsError } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .select("id,clock_in,clock_out")
      .eq("user_id", selectedUserId)
      .order("clock_in", { ascending: false })
      .limit(500);

    if (existingSessionsError) {
      return NextResponse.json({ error: toHebrewError(existingSessionsError.message) }, { status: 400 });
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
      const overlapSession = (existingSessions ?? []).find((row) => {
        if (typeof row.clock_in !== "string") return false;
        const existingClockOut = typeof row.clock_out === "string" ? row.clock_out : null;
        return overlaps(clockIn, clockOut, row.clock_in, existingClockOut);
      });

      if (overlapSession) {
        return NextResponse.json({ error: "המשמרת חופפת למשמרת אחרת." }, { status: 400 });
      }
    }

    const workedMinutes = minutesBetween(clockIn, clockOut);

    const { data, error } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .insert({
        user_id: selectedUserId,
        clock_in: clockIn,
        clock_out: clockOut,
        worked_minutes: workedMinutes,
        labor_cost: laborCost,
        is_billable_to_customer: isBillableToCustomer,
        bill_to_customer_amount: isBillableToCustomer ? billToCustomerAmount : null,
        billing_status: billingStatus,
        notes: notes || null,
        business_domain: businessDomain,
        project_id: businessDomain === "logistics_projects" ? projectId : null,
        property_id: businessDomain === "property_management" ? propertyId : null,
      })
      .select("id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    }

    const activeAgreement = getActiveSalaryAgreementForDate(
      (salaryAgreements ?? []) as SalaryAgreementRow[],
      new Date(clockIn)
    );

    if (laborCost === null && activeAgreement) {
      await recalculateUserSessionCostsFromRules(supabase, selectedUserId, {
        fromDate: clockIn.slice(0, 10),
        regeneratePayslips: false,
      });
      const refreshed = await supabase
        .from(WORK_SESSIONS_TABLE)
        .select("id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id")
        .eq("id", data?.id ?? "")
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
