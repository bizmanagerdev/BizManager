import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import { collectLockedSessionIds, recalculateUserSessionCostsFromRules, regenerateEditablePayslipsForUsers } from "@/lib/payroll-center";
import {
  normalizePayrollWorkerType,
  payrollWorkerTypeAllowsSessions,
  payrollWorkerTypeGeneratesPayslips,
} from "@/lib/payroll-worker-type";
import {
  getActiveSalaryAgreementForDate,
  minutesBetween,
  type SalaryAgreementRow,
  type PayrollPeriodRow,
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
  is_billable_to_customer?: boolean | null;
  bill_to_customer_amount?: number | string | null;
  billing_status?: string | null;
  labor_cost?: number | string | null;
  recalculate_labor_cost?: boolean | null;
};

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
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
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as UpdateSessionPayload;
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const businessDomain = isExpenseBusinessDomain(body.business_domain) ? body.business_domain : null;
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const propertyId = typeof body.property_id === "string" ? body.property_id.trim() : "";
    const clockIn = typeof body.clock_in === "string" ? body.clock_in.trim() : "";
    const clockOutInput = typeof body.clock_out === "string" ? body.clock_out.trim() : "";
    const clockOut = clockOutInput || null;
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    const requestedLaborCost = toNullableNumber(body.labor_cost);
    const recalculateLaborCost = body.recalculate_labor_cost === true;
    const isBillable = body.is_billable_to_customer === true;
    const billAmount = toNullableNumber(body.bill_to_customer_amount);
    const billingStatus =
      typeof body.billing_status === "string" && body.billing_status.trim()
        ? body.billing_status.trim()
        : isBillable
          ? "billable"
          : "not_billable";

    if (!sessionId || !userId || !businessDomain || !clockIn) {
      return NextResponse.json({ error: "Missing required session fields." }, { status: 400 });
    }
    if (businessDomain === "logistics_projects" && !projectId) {
      return NextResponse.json({ error: "Project is required for project work." }, { status: 400 });
    }
    if (businessDomain === "property_management" && !propertyId) {
      return NextResponse.json({ error: "Property is required for property work." }, { status: 400 });
    }
    if (isBillable && (billAmount === null || billAmount < 0)) {
      return NextResponse.json({ error: "Bill to customer amount is invalid." }, { status: 400 });
    }

    const start = new Date(clockIn);
    const end = clockOut ? new Date(clockOut) : null;
    if (Number.isNaN(start.getTime()) || (end && (Number.isNaN(end.getTime()) || end <= start))) {
      return NextResponse.json({ error: "Clock-out must be after clock-in." }, { status: 400 });
    }

    const { supabase, profile } = access.value;
    const [sessionResult, periodsResult, siblingsResult, agreementsResult, workerResult] = await Promise.all([
      supabase
        .from(WORK_SESSIONS_TABLE)
        .select(
          "id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id"
        )
        .eq("id", sessionId)
        .maybeSingle(),
      supabase.from("payroll_periods").select("id,period_month,start_date,end_date,status").range(0, 119),
      supabase
        .from(WORK_SESSIONS_TABLE)
        .select("id,clock_in,clock_out")
        .eq("user_id", userId)
        .neq("id", sessionId)
        .range(0, 999),
      supabase
        .from("salary_agreements")
        .select("id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours")
        .eq("user_id", userId)
        .order("valid_from", { ascending: false }),
      supabase
        .from("users")
        .select("id,payroll_worker_type,pay_tracking_mode")
        .eq("id", userId)
        .maybeSingle(),
    ]);

    if (sessionResult.error) return NextResponse.json({ error: sessionResult.error.message }, { status: 400 });
    if (periodsResult.error) return NextResponse.json({ error: periodsResult.error.message }, { status: 400 });
    if (siblingsResult.error) return NextResponse.json({ error: siblingsResult.error.message }, { status: 400 });
    if (agreementsResult.error) return NextResponse.json({ error: agreementsResult.error.message }, { status: 400 });
    if (workerResult.error) return NextResponse.json({ error: workerResult.error.message }, { status: 400 });
    if (!sessionResult.data) return NextResponse.json({ error: "Session not found." }, { status: 404 });
    if (!workerResult.data?.id) return NextResponse.json({ error: "Worker not found." }, { status: 404 });

    const workerType = normalizePayrollWorkerType(
      workerResult.data.payroll_worker_type,
      workerResult.data.pay_tracking_mode
    );
    if (!payrollWorkerTypeAllowsSessions(workerType)) {
      return NextResponse.json({ error: "This worker type does not use sessions." }, { status: 409 });
    }
    const shouldRegenerateCurrentWorkerPayslips = payrollWorkerTypeGeneratesPayslips(workerType);

    const lockedIds = collectLockedSessionIds(
      [{ id: sessionId, clock_in: clockIn }],
      (periodsResult.data ?? []) as PayrollPeriodRow[]
    );
    if (lockedIds.has(sessionId)) {
      return NextResponse.json({ error: "This session belongs to a locked payroll period." }, { status: 409 });
    }

    if (workerType !== "session_only") {
      const hasOverlap = ((siblingsResult.data ?? []) as Array<{ clock_in: string; clock_out: string | null }>).some(
        (row) => overlaps(clockIn, clockOut, row.clock_in, row.clock_out)
      );
      if (hasOverlap) {
        return NextResponse.json({ error: "This session overlaps another session." }, { status: 400 });
      }
    }

    const activeAgreement = getActiveSalaryAgreementForDate(
      (agreementsResult.data ?? []) as SalaryAgreementRow[],
      new Date(clockIn)
    );
    const canRecalculateLaborCost = recalculateLaborCost && Boolean(activeAgreement);

    let laborCost = sessionResult.data.labor_cost;
    if (requestedLaborCost !== null) {
      laborCost = requestedLaborCost;
    } else if (canRecalculateLaborCost) {
      laborCost = null;
    }

    const previousUserId = sessionResult.data.user_id;
    const previousClockIn = sessionResult.data.clock_in;
    let shouldRegeneratePreviousWorkerPayslips = shouldRegenerateCurrentWorkerPayslips;

    if (previousUserId && previousUserId !== userId) {
      const previousWorkerResult = await supabase
        .from("users")
        .select("id,payroll_worker_type,pay_tracking_mode")
        .eq("id", previousUserId)
        .maybeSingle();

      if (previousWorkerResult.error) {
        return NextResponse.json({ error: previousWorkerResult.error.message }, { status: 400 });
      }

      const previousWorkerType = normalizePayrollWorkerType(
        previousWorkerResult.data?.payroll_worker_type ?? null,
        previousWorkerResult.data?.pay_tracking_mode ?? "session"
      );
      shouldRegeneratePreviousWorkerPayslips = payrollWorkerTypeGeneratesPayslips(previousWorkerType);
    }

    const updateResult = await supabase
      .from(WORK_SESSIONS_TABLE)
      .update({
        user_id: userId,
        business_domain: businessDomain,
        project_id: businessDomain === "logistics_projects" ? projectId : null,
        property_id: businessDomain === "property_management" ? propertyId : null,
        notes: notes || null,
        clock_in: clockIn,
        clock_out: clockOut,
        worked_minutes: clockOut ? minutesBetween(clockIn, clockOut) : null,
        labor_cost: laborCost,
        is_billable_to_customer: isBillable,
        bill_to_customer_amount: isBillable ? billAmount : null,
        billing_status: billingStatus,
      })
      .eq("id", sessionId)
      .select(
        "id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id"
      )
      .maybeSingle();

    if (updateResult.error) {
      return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
    }

    if (canRecalculateLaborCost && requestedLaborCost === null && clockOut) {
      await recalculateUserSessionCostsFromRules(supabase, userId, {
        fromDate: clockIn.slice(0, 10),
        regeneratePayslips: shouldRegenerateCurrentWorkerPayslips,
      });
      if (previousUserId && previousUserId !== userId) {
        await recalculateUserSessionCostsFromRules(supabase, previousUserId, {
          fromDate: previousClockIn.slice(0, 10),
          regeneratePayslips: shouldRegeneratePreviousWorkerPayslips,
        });
      } else if (previousClockIn.slice(0, 10) !== clockIn.slice(0, 10)) {
        await recalculateUserSessionCostsFromRules(supabase, previousUserId, {
          fromDate: previousClockIn.slice(0, 10),
          regeneratePayslips: shouldRegenerateCurrentWorkerPayslips,
        });
      }
      const refreshed = await supabase
        .from(WORK_SESSIONS_TABLE)
        .select(
          "id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id"
        )
        .eq("id", sessionId)
        .maybeSingle();
      if (refreshed.error) {
        return NextResponse.json({ error: refreshed.error.message }, { status: 400 });
      }
      if (refreshed.data?.id) {
        await logAuditEvent({
          supabase,
          tableName: WORK_SESSIONS_TABLE,
          recordId: refreshed.data.id,
          action: "update",
          changedBy: profile.id,
          userRole: profile.role,
        });
      }
      return NextResponse.json({ session: refreshed.data });
    }

    if (shouldRegenerateCurrentWorkerPayslips || shouldRegeneratePreviousWorkerPayslips) {
      await regenerateEditablePayslipsForUsers(
        supabase,
        [shouldRegeneratePreviousWorkerPayslips ? previousUserId : "", shouldRegenerateCurrentWorkerPayslips ? userId : ""]
      );
    }

    if (updateResult.data?.id) {
      await logAuditEvent({
        supabase,
        tableName: WORK_SESSIONS_TABLE,
        recordId: updateResult.data.id,
        action: "update",
        changedBy: profile.id,
        userRole: profile.role,
      });
    }

    return NextResponse.json({ session: updateResult.data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
