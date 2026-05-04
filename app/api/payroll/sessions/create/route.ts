import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import { recalculateUserSessionCostsFromRules, regenerateEditablePayslipsForUsers } from "@/lib/payroll-center";
import {
  getActiveSalaryAgreementForDate,
  minutesBetween,
  type SalaryAgreementRow,
  WORK_SESSIONS_TABLE,
} from "@/lib/payroll";

type CreatePayrollSessionPayload = {
  user_id?: string | null;
  business_domain?: string | null;
  project_id?: string | null;
  property_id?: string | null;
  notes?: string | null;
  clock_in?: string | null;
  clock_out?: string | null;
  labor_cost?: number | string | null;
};

function toOptionalNonNegativeNumber(value: unknown) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as CreatePayrollSessionPayload;
    const businessDomain = isExpenseBusinessDomain(body.business_domain) ? body.business_domain : null;
    const selectedUserId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const propertyId = typeof body.property_id === "string" ? body.property_id.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    const clockIn = typeof body.clock_in === "string" ? body.clock_in.trim() : "";
    const clockOut = typeof body.clock_out === "string" ? body.clock_out.trim() : "";
    const requestedLaborCost = toOptionalNonNegativeNumber(body.labor_cost);

    if (!businessDomain) {
      return NextResponse.json({ error: "Missing or invalid business_domain" }, { status: 400 });
    }
    if (!selectedUserId) {
      return NextResponse.json({ error: "יש לבחור עובד." }, { status: 400 });
    }
    if (!clockIn || !clockOut) {
      return NextResponse.json({ error: "יש להזין שעת התחלה ושעת סיום." }, { status: 400 });
    }
    if (businessDomain === "logistics_projects" && !projectId) {
      return NextResponse.json({ error: "יש לבחור פרויקט." }, { status: 400 });
    }
    if (businessDomain === "property_management" && !propertyId) {
      return NextResponse.json({ error: "יש לבחור נכס." }, { status: 400 });
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

    const { supabase, profile } = access.value;

    const { data: selectedUser, error: selectedUserError } = await supabase
      .from("users")
      .select("id,role,active")
      .eq("id", selectedUserId)
      .maybeSingle();

    if (selectedUserError) {
      return NextResponse.json({ error: selectedUserError.message }, { status: 400 });
    }
    if (!selectedUser?.id) {
      return NextResponse.json({ error: "העובד שנבחר לא נמצא." }, { status: 404 });
    }
    if (selectedUser.active === false) {
      return NextResponse.json({ error: "לא ניתן להוסיף משמרת לעובד לא פעיל." }, { status: 400 });
    }
    if (selectedUser.role !== "worker" && selectedUser.role !== "worker_no_access") {
      return NextResponse.json({ error: "ניתן לבחור רק עובד או עובד ללא גישה." }, { status: 400 });
    }

    if (businessDomain === "logistics_projects") {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .maybeSingle();
      if (projectError) return NextResponse.json({ error: projectError.message }, { status: 400 });
      if (!project) return NextResponse.json({ error: "הפרויקט שנבחר לא נמצא." }, { status: 404 });
    }

    if (businessDomain === "property_management") {
      const { data: property, error: propertyError } = await supabase
        .from("properties")
        .select("id")
        .eq("id", propertyId)
        .maybeSingle();
      if (propertyError) return NextResponse.json({ error: propertyError.message }, { status: 400 });
      if (!property) return NextResponse.json({ error: "הנכס שנבחר לא נמצא." }, { status: 404 });
    }

    const { data: existingSessions, error: existingSessionsError } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .select("id,clock_in,clock_out")
      .eq("user_id", selectedUserId)
      .order("clock_in", { ascending: false })
      .limit(500);

    if (existingSessionsError) {
      return NextResponse.json({ error: existingSessionsError.message }, { status: 400 });
    }

    const { data: salaryAgreements, error: salaryAgreementsError } = await supabase
      .from("salary_agreements")
      .select("id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours")
      .eq("user_id", selectedUserId)
      .order("valid_from", { ascending: false });

    if (salaryAgreementsError) {
      return NextResponse.json({ error: salaryAgreementsError.message }, { status: 400 });
    }

    const overlapSession = (existingSessions ?? []).find((row) => {
      if (typeof row.clock_in !== "string") return false;
      const existingClockOut = typeof row.clock_out === "string" ? row.clock_out : null;
      return overlaps(clockIn, clockOut, row.clock_in, existingClockOut);
    });

    if (overlapSession) {
      return NextResponse.json({ error: "המשמרת חופפת למשמרת אחרת." }, { status: 400 });
    }

    const workedMinutes = minutesBetween(clockIn, clockOut);

    const { data, error } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .insert({
        user_id: selectedUserId,
        clock_in: clockIn,
        clock_out: clockOut,
        worked_minutes: workedMinutes,
        labor_cost: requestedLaborCost,
        notes: notes || null,
        business_domain: businessDomain,
        project_id: businessDomain === "logistics_projects" ? projectId : null,
        property_id: businessDomain === "property_management" ? propertyId : null,
      })
      .select(
        "id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id"
      )
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const activeAgreement = getActiveSalaryAgreementForDate(
      (salaryAgreements ?? []) as SalaryAgreementRow[],
      new Date(clockIn)
    );

    if (requestedLaborCost === null && activeAgreement) {
      await recalculateUserSessionCostsFromRules(supabase, selectedUserId, {
        fromDate: clockIn.slice(0, 10),
      });
      const refreshed = await supabase
        .from(WORK_SESSIONS_TABLE)
        .select(
          "id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id"
        )
        .eq("id", data?.id ?? "")
        .maybeSingle();
      if (refreshed.error) {
        return NextResponse.json({ error: refreshed.error.message }, { status: 400 });
      }
      if (refreshed.data?.id) {
        await logAuditEvent({
          supabase,
          tableName: WORK_SESSIONS_TABLE,
          recordId: refreshed.data.id,
          action: "create",
          changedBy: profile.id,
          userRole: profile.role,
        });
      }
      return NextResponse.json({ session: refreshed.data });
    }

    await regenerateEditablePayslipsForUsers(supabase, [selectedUserId]);

    if (data?.id) {
      await logAuditEvent({
        supabase,
        tableName: WORK_SESSIONS_TABLE,
        recordId: data.id,
        action: "create",
        changedBy: profile.id,
        userRole: profile.role,
      });
    }

    return NextResponse.json({ session: data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
