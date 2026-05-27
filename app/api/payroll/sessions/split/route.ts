import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import { collectLockedSessionIds, recalculateUserSessionCostsFromRules } from "@/lib/payroll-center";
import {
  normalizePayrollWorkerType,
  payrollWorkerTypeAllowsSessions,
  payrollWorkerTypeGeneratesPayslips,
} from "@/lib/payroll-worker-type";
import { addMinutes, type PayrollPeriodRow, WORK_SESSIONS_TABLE } from "@/lib/payroll";

type SplitPartPayload = {
  minutes?: number | string | null;
  business_domain?: string | null;
  project_id?: string | null;
  property_id?: string | null;
};

type SplitSessionPayload = {
  session_id?: string;
  parts?: SplitPartPayload[];
};

type NormalizedPart = {
  minutes: number;
  businessDomain: string;
  projectId: string | null;
  propertyId: string | null;
};

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return NaN;
}

function formatDateOnly(value: string) {
  return value.slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as SplitSessionPayload;
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    const rawParts = Array.isArray(body.parts) ? body.parts : [];

    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
    }
    if (rawParts.length < 2) {
      return NextResponse.json({ error: "יש להזין לפחות שני חלקים לפיצול." }, { status: 400 });
    }

    const { supabase, profile } = access.value;
    const [sessionResult, periodsResult] = await Promise.all([
      supabase
        .from(WORK_SESSIONS_TABLE)
        .select("id,user_id,clock_in,clock_out,worked_minutes,notes,business_domain,project_id,property_id")
        .eq("id", sessionId)
        .maybeSingle(),
      supabase.from("payroll_periods").select("id,period_month,start_date,end_date,status").range(0, 119),
    ]);

    if (sessionResult.error) return NextResponse.json({ error: sessionResult.error.message }, { status: 400 });
    if (periodsResult.error) return NextResponse.json({ error: periodsResult.error.message }, { status: 400 });
    if (!sessionResult.data || typeof sessionResult.data.clock_in !== "string" || typeof sessionResult.data.clock_out !== "string") {
      return NextResponse.json({ error: "Saved session not found" }, { status: 404 });
    }

    const lockedIds = collectLockedSessionIds(
      [{ id: sessionResult.data.id, clock_in: sessionResult.data.clock_in }],
      (periodsResult.data ?? []) as PayrollPeriodRow[]
    );
    if (lockedIds.has(sessionId)) {
      return NextResponse.json({ error: "This session belongs to a locked payroll period." }, { status: 409 });
    }

    const originalSession = sessionResult.data;
    const originalStartMs = new Date(originalSession.clock_in).getTime();
    const originalEndMs = new Date(originalSession.clock_out).getTime();
    const totalMinutes = Math.round((originalEndMs - originalStartMs) / 60000);

    if (!Number.isFinite(totalMinutes) || totalMinutes <= 1) {
      return NextResponse.json({ error: "Session is too short to split" }, { status: 400 });
    }
    if (rawParts.length > totalMinutes) {
      return NextResponse.json({ error: "לא ניתן לפצל ליותר חלקים ממספר הדקות במשמרת." }, { status: 400 });
    }

    const normalizedParts: NormalizedPart[] = [];
    let consumedMinutes = 0;

    for (let index = 0; index < rawParts.length; index += 1) {
      const part = rawParts[index];
      const businessDomain = isExpenseBusinessDomain(part.business_domain) ? part.business_domain : null;
      const projectId = typeof part.project_id === "string" && part.project_id.trim() ? part.project_id.trim() : null;
      const propertyId = typeof part.property_id === "string" && part.property_id.trim() ? part.property_id.trim() : null;

      if (!businessDomain) {
        return NextResponse.json({ error: `תחום לא תקין בחלק ${index + 1}.` }, { status: 400 });
      }
      if (businessDomain === "logistics_projects" && !projectId) {
        return NextResponse.json({ error: `יש לבחור פרויקט בחלק ${index + 1}.` }, { status: 400 });
      }
      if (businessDomain === "property_management" && !propertyId) {
        return NextResponse.json({ error: `יש לבחור נכס בחלק ${index + 1}.` }, { status: 400 });
      }

      let minutes = Math.round(toNumber(part.minutes));
      if (index === rawParts.length - 1) {
        minutes = totalMinutes - consumedMinutes;
      }

      if (!Number.isFinite(minutes) || minutes <= 0) {
        return NextResponse.json({ error: `משך לא תקין בחלק ${index + 1}.` }, { status: 400 });
      }
      if (index < rawParts.length - 1) {
        const remainingParts = rawParts.length - index - 1;
        if (consumedMinutes + minutes > totalMinutes - remainingParts) {
          return NextResponse.json({ error: "סכום הדקות גדול ממשך המשמרת, ולא נשאר זמן לכל החלקים." }, { status: 400 });
        }
      }

      consumedMinutes += minutes;
      normalizedParts.push({
        minutes,
        businessDomain,
        projectId: businessDomain === "logistics_projects" ? projectId : null,
        propertyId: businessDomain === "property_management" ? propertyId : null,
      });
    }

    if (consumedMinutes !== totalMinutes) {
      return NextResponse.json({ error: "סכום החלקים חייב להיות שווה לאורך המשמרת." }, { status: 400 });
    }

    for (const part of normalizedParts) {
      if (part.projectId) {
        const { data: project, error: projectError } = await supabase.from("projects").select("id").eq("id", part.projectId).maybeSingle();
        if (projectError) return NextResponse.json({ error: projectError.message }, { status: 400 });
        if (!project) return NextResponse.json({ error: "הפרויקט שנבחר לא נמצא." }, { status: 404 });
      }
      if (part.propertyId) {
        const { data: property, error: propertyError } = await supabase.from("properties").select("id").eq("id", part.propertyId).maybeSingle();
        if (propertyError) return NextResponse.json({ error: propertyError.message }, { status: 400 });
        if (!property) return NextResponse.json({ error: "הנכס שנבחר לא נמצא." }, { status: 404 });
      }
    }

    let cursor = originalSession.clock_in;
    const computedRanges = normalizedParts.map((part) => {
      const nextTime = addMinutes(cursor, part.minutes);
      if (!nextTime) throw new Error("Could not calculate split time");
      const range = {
        ...part,
        clockIn: cursor,
        clockOut: nextTime.toISOString(),
      };
      cursor = range.clockOut;
      return range;
    });

    const firstRange = computedRanges[0];
    const { error: updateError } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .update({
        clock_out: firstRange.clockOut,
        worked_minutes: firstRange.minutes,
        business_domain: firstRange.businessDomain,
        project_id: firstRange.projectId,
        property_id: firstRange.propertyId,
        labor_cost: null,
      })
      .eq("id", sessionId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    const insertRows = computedRanges.slice(1).map((part) => ({
      user_id: originalSession.user_id,
      clock_in: part.clockIn,
      clock_out: part.clockOut,
      worked_minutes: part.minutes,
      labor_cost: null,
      notes: originalSession.notes ?? null,
      business_domain: part.businessDomain,
      project_id: part.projectId,
      property_id: part.propertyId,
    }));

    let insertedIds: string[] = [];
    if (insertRows.length > 0) {
      const { data: insertedRows, error: insertError } = await supabase
        .from(WORK_SESSIONS_TABLE)
        .insert(insertRows)
        .select("id");

      if (insertError) {
        await supabase
          .from(WORK_SESSIONS_TABLE)
          .update({
            clock_out: originalSession.clock_out,
            worked_minutes: originalSession.worked_minutes,
            business_domain: originalSession.business_domain,
            project_id: originalSession.project_id,
            property_id: originalSession.property_id,
          })
          .eq("id", sessionId);

        return NextResponse.json({ error: insertError.message }, { status: 400 });
      }

      insertedIds = ((insertedRows ?? []) as Array<{ id?: string }>).map((row) => row.id ?? "").filter(Boolean);
    }

    const workerResult = await supabase
      .from("users")
      .select("id,payroll_worker_type,pay_tracking_mode")
      .eq("id", originalSession.user_id)
      .maybeSingle();

    if (workerResult.error) {
      return NextResponse.json({ error: workerResult.error.message }, { status: 400 });
    }

    const workerType = normalizePayrollWorkerType(
      workerResult.data?.payroll_worker_type ?? null,
      workerResult.data?.pay_tracking_mode ?? "session"
    );
    if (!payrollWorkerTypeAllowsSessions(workerType)) {
      return NextResponse.json({ error: "This worker type does not use sessions." }, { status: 409 });
    }

    await recalculateUserSessionCostsFromRules(supabase, originalSession.user_id, {
      fromDate: formatDateOnly(originalSession.clock_in),
      regeneratePayslips: payrollWorkerTypeGeneratesPayslips(workerType),
    });

    await logAuditEvent({
      supabase,
      tableName: WORK_SESSIONS_TABLE,
      recordId: sessionId,
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
    });

    for (const insertedId of insertedIds) {
      await logAuditEvent({
        supabase,
        tableName: WORK_SESSIONS_TABLE,
        recordId: insertedId,
        action: "create",
        changedBy: profile.id,
        userRole: profile.role,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
