import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import { recalculateUserSessionCostsFromRules } from "@/lib/payroll-center";
import { normalizePayrollWorkerType, payrollWorkerTypeAllowsSessions } from "@/lib/payroll-worker-type";
import { WORK_SESSIONS_TABLE } from "@/lib/payroll";

type EndSessionPayload = {
  notes?: string | null;
  business_domain?: string | null;
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as EndSessionPayload;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const businessDomain = isExpenseBusinessDomain(body.business_domain)
      ? body.business_domain
      : "general_business";
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
      .select("id,clock_in,notes")
      .eq("user_id", profile.id)
      .is("clock_out", null)
      .order("clock_in", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (openSessionError) {
      return NextResponse.json({ error: openSessionError.message }, { status: 400 });
    }

    if (!openSession || typeof openSession.id !== "string") {
      return NextResponse.json({ error: "לא נמצאה משמרת פתוחה לסגירה." }, { status: 400 });
    }

    const startedAt = new Date(String(openSession.clock_in)).getTime();
    const endedAtIso = new Date().toISOString();
    const endedAt = new Date(endedAtIso).getTime();
    const workedMinutes =
      Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt > startedAt
        ? Math.round((endedAt - startedAt) / 60000)
        : 0;

    const nextNotes = [openSession.notes, notes].filter(Boolean).join("\n");

    const { data, error } = await supabase
      .from(WORK_SESSIONS_TABLE)
      .update({
        clock_out: endedAtIso,
        worked_minutes: workedMinutes,
        notes: nextNotes || null,
        business_domain: businessDomain,
      })
      .eq("id", openSession.id)
      .select("id,user_id,clock_in,clock_out,worked_minutes,notes,business_domain,project_id,property_id")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await recalculateUserSessionCostsFromRules(supabase, profile.id, {
      fromDate: endedAtIso.slice(0, 10),
      regeneratePayslips: false,
    });

    return NextResponse.json({ session: data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
