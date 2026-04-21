import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import { minutesBetween, WORK_SESSIONS_TABLE } from "@/lib/payroll";

type UpdateSessionPayload = {
  session_id?: string;
  business_domain?: string | null;
  project_id?: string | null;
  property_id?: string | null;
  notes?: string | null;
  clock_in?: string | null;
  clock_out?: string | null;
};

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

    const body = (await req.json().catch(() => ({}))) as UpdateSessionPayload;
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    const businessDomain = isExpenseBusinessDomain(body.business_domain)
      ? body.business_domain
      : null;
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
    const propertyId = typeof body.property_id === "string" ? body.property_id.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    const clockIn = typeof body.clock_in === "string" ? body.clock_in.trim() : "";
    const clockOutInput = typeof body.clock_out === "string" ? body.clock_out.trim() : "";
    const clockOut = clockOutInput || null;

    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
    }
    if (!businessDomain) {
      return NextResponse.json({ error: "Missing or invalid business_domain" }, { status: 400 });
    }
    if (!clockIn) {
      return NextResponse.json({ error: "יש להזין שעת התחלה." }, { status: 400 });
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

    const { supabase, user } = access.value;

    const { data: session, error: sessionError } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .select("id,user_id")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 400 });
    }
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
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

    const { data: siblingSessions, error: siblingSessionsError } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .select("id,clock_in,clock_out")
      .eq("user_id", user.id)
      .neq("id", sessionId)
      .order("clock_in", { ascending: false })
      .limit(500);

    if (siblingSessionsError) {
      return NextResponse.json({ error: siblingSessionsError.message }, { status: 400 });
    }

    const overlapSession = (siblingSessions ?? []).find((row) => {
      if (typeof row.clock_in !== "string") return false;
      const siblingClockOut = typeof row.clock_out === "string" ? row.clock_out : null;
      return overlaps(clockIn, clockOut, row.clock_in, siblingClockOut);
    });

    if (overlapSession) {
      return NextResponse.json({ error: "המשמרת חופפת למשמרת אחרת." }, { status: 400 });
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

    const { data, error } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .update({
        clock_in: clockIn,
        clock_out: clockOut,
        worked_minutes: clockOut ? minutesBetween(clockIn, clockOut) : null,
        notes: notes || null,
        business_domain: businessDomain,
        project_id: businessDomain === "logistics_projects" ? projectId : null,
        property_id: businessDomain === "property_management" ? propertyId : null,
      })
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .select("id,user_id,clock_in,clock_out,worked_minutes,notes,business_domain,project_id,property_id")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ session: data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
