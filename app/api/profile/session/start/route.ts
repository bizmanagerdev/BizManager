import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { normalizePayrollWorkerType, payrollWorkerTypeAllowsSessions } from "@/lib/payroll-worker-type";
import { WORK_SESSIONS_TABLE } from "@/lib/payroll";

type StartSessionPayload = {
  notes?: string | null;
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as StartSessionPayload;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const { supabase, profile } = access.value;
    const workerResult = await supabase
      .from("users")
      .select("id,payroll_worker_type,pay_tracking_mode")
      .eq("id", profile.id)
      .maybeSingle();

    if (workerResult.error) {
      return NextResponse.json({ error: workerResult.error.message }, { status: 400 });
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

    const { data: openSession, error: openSessionError } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .select("id")
      .eq("user_id", profile.id)
      .is("clock_out", null)
      .limit(1)
      .maybeSingle();

    if (openSessionError) {
      return NextResponse.json({ error: openSessionError.message }, { status: 400 });
    }

    if (openSession) {
      return NextResponse.json({ error: "יש כבר משמרת פתוחה עבור המשתמש הזה." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .insert({
        user_id: profile.id,
        clock_in: new Date().toISOString(),
        notes,
        business_domain: "general_business",
      })
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
