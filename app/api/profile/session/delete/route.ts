import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { recalculateUserSessionCostsFromRules } from "@/lib/payroll-center";
import { normalizePayrollWorkerType, payrollWorkerTypeAllowsSessions } from "@/lib/payroll-worker-type";
import { WORK_SESSIONS_TABLE } from "@/lib/payroll";

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as {
      session_id?: string | null;
      project_id?: string | null;
    };

    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";

    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
    }

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

    const { data: session, error: sessionError } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .select("id,user_id,clock_in,project_id")
      .eq("id", sessionId)
      .eq("user_id", profile.id)
      .maybeSingle();

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 400 });
    }
    if (!session?.id) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (projectId && session.project_id !== projectId) {
      return NextResponse.json({ error: "Session not found for project" }, { status: 404 });
    }

    const deleteAllocationsResult = await supabase
      .from("worker_payment_allocations")
      .delete()
      .eq("attendance_session_id", sessionId);
    if (deleteAllocationsResult.error) {
      return NextResponse.json({ error: deleteAllocationsResult.error.message }, { status: 400 });
    }

    const { error } = await supabase.from(WORK_SESSIONS_TABLE).delete().eq("id", sessionId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await recalculateUserSessionCostsFromRules(supabase, profile.id, {
      fromDate: session.clock_in.slice(0, 10),
      regeneratePayslips: false,
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
