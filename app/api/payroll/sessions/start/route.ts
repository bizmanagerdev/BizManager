import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import { normalizePayrollWorkerType, payrollWorkerTypeAllowsSessions } from "@/lib/payroll-worker-type";
import { WORK_SESSIONS_TABLE } from "@/lib/payroll";

type StartPayrollSessionPayload = {
  user_id?: string | null;
  business_domain?: string | null;
  project_id?: string | null;
  property_id?: string | null;
  notes?: string | null;
  clock_in?: string | null;
};

function overlapsOpenSession(start: string, otherStart: string, otherEnd: string | null) {
  const startMs = new Date(start).getTime();
  const otherStartMs = new Date(otherStart).getTime();
  const otherEndMs = otherEnd ? new Date(otherEnd).getTime() : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(startMs) || !Number.isFinite(otherStartMs)) return false;
  return startMs < otherEndMs && otherStartMs < Number.POSITIVE_INFINITY;
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as StartPayrollSessionPayload;
    const selectedUserId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const businessDomain = isExpenseBusinessDomain(body.business_domain) ? body.business_domain : "general_business";
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const propertyId = typeof body.property_id === "string" ? body.property_id.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    const clockIn = typeof body.clock_in === "string" && body.clock_in.trim() ? body.clock_in.trim() : new Date().toISOString();

    if (!selectedUserId) {
      return NextResponse.json({ error: "יש לבחור עובד." }, { status: 400 });
    }
    if (businessDomain === "logistics_projects" && !projectId) {
      return NextResponse.json({ error: "יש לבחור פרויקט." }, { status: 400 });
    }
    if (businessDomain === "property_management" && !propertyId) {
      return NextResponse.json({ error: "יש לבחור נכס." }, { status: 400 });
    }
    if (Number.isNaN(new Date(clockIn).getTime())) {
      return NextResponse.json({ error: "שעת ההתחלה לא תקינה." }, { status: 400 });
    }

    const { supabase } = access.value;

    const { data: selectedUser, error: selectedUserError } = await supabase
      .from("users")
      .select("id,role,active,payroll_worker_type,pay_tracking_mode")
      .eq("id", selectedUserId)
      .maybeSingle();

    if (selectedUserError) {
      return NextResponse.json({ error: toHebrewError(selectedUserError.message) }, { status: 400 });
    }
    if (!selectedUser?.id) {
      return NextResponse.json({ error: "העובד שנבחר לא נמצא." }, { status: 404 });
    }
    if (selectedUser.active === false) {
      return NextResponse.json({ error: "לא ניתן לפתוח משמרת לעובד לא פעיל." }, { status: 400 });
    }
    if (selectedUser.role !== "worker" && selectedUser.role !== "worker_no_access") {
      return NextResponse.json({ error: "ניתן לבחור רק עובד או עובד ללא גישה." }, { status: 400 });
    }

    const workerType = normalizePayrollWorkerType(selectedUser.payroll_worker_type, selectedUser.pay_tracking_mode);
    if (!payrollWorkerTypeAllowsSessions(workerType)) {
      return NextResponse.json({ error: "This worker type does not use sessions." }, { status: 409 });
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

    const overlappingSession = (existingSessions ?? []).find((row) => {
      if (typeof row.clock_in !== "string") return false;
      const existingClockOut = typeof row.clock_out === "string" ? row.clock_out : null;
      return overlapsOpenSession(clockIn, row.clock_in, existingClockOut);
    });
    if (overlappingSession) {
      return NextResponse.json({ error: "יש כבר משמרת חופפת לעובד הזה." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .insert({
        user_id: selectedUserId,
        clock_in: clockIn,
        notes: notes || null,
        business_domain: businessDomain,
        project_id: businessDomain === "logistics_projects" ? projectId : null,
        property_id: businessDomain === "property_management" ? propertyId : null,
      })
      .select("id,user_id,clock_in,clock_out,worked_minutes,notes,business_domain,project_id,property_id")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    }

    return NextResponse.json({ session: data });
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
