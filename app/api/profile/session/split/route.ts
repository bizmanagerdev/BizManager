import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import { recalculateUserSessionCostsFromRules } from "@/lib/payroll-center";
import { normalizePayrollWorkerType, payrollWorkerTypeAllowsSessions } from "@/lib/payroll-worker-type";
import { addMinutes, minutesBetween, WORK_SESSIONS_TABLE } from "@/lib/payroll";

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

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return NaN;
}

type NormalizedPart = {
  minutes: number;
  businessDomain: string;
  projectId: string | null;
  propertyId: string | null;
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
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
    const workerResult = await supabase
      .from("users")
      .select("id,payroll_worker_type,pay_tracking_mode")
      .eq("id", profile.id)
      .maybeSingle();

    if (workerResult.error) {
      return NextResponse.json({ error: toHebrewError(workerResult.error.message) }, { status: 400 });
    }
    if (!workerResult.data?.id) {
      return NextResponse.json({ error: "Worker not found." }, { status: 404 });
    }

    const workerType = normalizePayrollWorkerType(
      workerResult.data.payroll_worker_type,
      workerResult.data.pay_tracking_mode
    );
    if (!payrollWorkerTypeAllowsSessions(workerType)) {
      return NextResponse.json({ error: "Worker type does not use sessions." }, { status: 409 });
    }

    const { data: session, error: sessionError } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .select("id,user_id,clock_in,clock_out,worked_minutes,notes,business_domain,project_id,property_id")
      .eq("id", sessionId)
      .eq("user_id", profile.id)
      .maybeSingle();

    if (sessionError) {
      return NextResponse.json({ error: toHebrewError(sessionError.message) }, { status: 400 });
    }
    if (!session || typeof session.clock_in !== "string" || typeof session.clock_out !== "string") {
      return NextResponse.json({ error: "Saved session not found" }, { status: 404 });
    }

    const totalMinutes = minutesBetween(session.clock_in, session.clock_out);
    if (totalMinutes <= 1) {
      return NextResponse.json({ error: "Session is too short to split" }, { status: 400 });
    }
    if (rawParts.length > totalMinutes) {
      return NextResponse.json(
        { error: "לא ניתן לפצל ליותר חלקים ממספר הדקות במשמרת." },
        { status: 400 }
      );
    }

    const normalizedParts: NormalizedPart[] = [];
    let consumedMinutes = 0;

    for (let index = 0; index < rawParts.length; index += 1) {
      const part = rawParts[index];
      const businessDomain = isExpenseBusinessDomain(part.business_domain)
        ? part.business_domain
        : null;
      const projectId =
        typeof part.project_id === "string" && part.project_id.trim() ? part.project_id.trim() : null;
      const propertyId =
        typeof part.property_id === "string" && part.property_id.trim()
          ? part.property_id.trim()
          : null;

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
          return NextResponse.json(
            { error: "סכום הדקות גדול ממשך המשמרת, ולא נשאר זמן לכל החלקים." },
            { status: 400 }
          );
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
        const { data: project, error: projectError } = await supabase
          .from("projects")
          .select("id")
          .eq("id", part.projectId)
          .maybeSingle();
        if (projectError) return NextResponse.json({ error: toHebrewError(projectError.message) }, { status: 400 });
        if (!project) return NextResponse.json({ error: "הפרויקט שנבחר לא נמצא." }, { status: 404 });
      }
      if (part.propertyId) {
        const { data: property, error: propertyError } = await supabase
          .from("properties")
          .select("id")
          .eq("id", part.propertyId)
          .maybeSingle();
        if (propertyError) return NextResponse.json({ error: toHebrewError(propertyError.message) }, { status: 400 });
        if (!property) return NextResponse.json({ error: "הנכס שנבחר לא נמצא." }, { status: 404 });
      }
    }

    const originalClockOut = session.clock_out;
    const originalWorkedMinutes = session.worked_minutes;
    const originalBusinessDomain = session.business_domain;
    const originalProjectId = session.project_id;
    const originalPropertyId = session.property_id;

    let cursor = session.clock_in;
    const computedRanges = normalizedParts.map((part) => {
      const nextTime = addMinutes(cursor, part.minutes);
      if (!nextTime) {
        throw new Error("Could not calculate split time");
      }
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
      })
      .eq("id", sessionId)
      .eq("user_id", profile.id);

    if (updateError) {
      return NextResponse.json({ error: toHebrewError(updateError.message) }, { status: 400 });
    }

    const insertRows = computedRanges.slice(1).map((part) => ({
      user_id: profile.id,
      clock_in: part.clockIn,
      clock_out: part.clockOut,
      worked_minutes: part.minutes,
      notes: session.notes ?? null,
      business_domain: part.businessDomain,
      project_id: part.projectId,
      property_id: part.propertyId,
    }));

    if (insertRows.length > 0) {
      const { error: insertError } = await supabase.from(WORK_SESSIONS_TABLE).insert(insertRows);
      if (insertError) {
        await supabase
          .from(WORK_SESSIONS_TABLE)
          .update({
            clock_out: originalClockOut,
            worked_minutes: originalWorkedMinutes,
            business_domain: originalBusinessDomain,
            project_id: originalProjectId,
            property_id: originalPropertyId,
          })
          .eq("id", sessionId)
          .eq("user_id", profile.id);

        return NextResponse.json({ error: toHebrewError(insertError.message) }, { status: 400 });
      }
    }

    await recalculateUserSessionCostsFromRules(supabase, profile.id, {
      fromDate: session.clock_in.slice(0, 10),
      regeneratePayslips: false,
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
