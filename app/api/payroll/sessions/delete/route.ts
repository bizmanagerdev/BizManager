import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { collectLockedSessionIds, recalculateUserSessionCostsFromRules } from "@/lib/payroll-center";
import {
  normalizePayrollWorkerType,
  payrollWorkerTypeGeneratesPayslips,
} from "@/lib/payroll-worker-type";
import type { PayrollPeriodRow } from "@/lib/payroll";
import { WORK_SESSIONS_TABLE } from "@/lib/payroll";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as { session_id?: string };
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id." }, { status: 400 });
    }

    const { supabase, profile } = access.value;
    const adminSupabase = createSupabaseAdminClient() ?? supabase;
    const [sessionResult, periodsResult] = await Promise.all([
      adminSupabase.from(WORK_SESSIONS_TABLE).select("id,user_id,clock_in").eq("id", sessionId).maybeSingle(),
      supabase.from("payroll_periods").select("id,period_month,start_date,end_date,status").range(0, 119),
    ]);

    if (sessionResult.error) return NextResponse.json({ error: toHebrewError(sessionResult.error.message) }, { status: 400 });
    if (periodsResult.error) return NextResponse.json({ error: toHebrewError(periodsResult.error.message) }, { status: 400 });
    if (!sessionResult.data) return NextResponse.json({ error: "Session not found." }, { status: 404 });

    const lockedIds = collectLockedSessionIds([sessionResult.data], (periodsResult.data ?? []) as PayrollPeriodRow[]);
    if (lockedIds.has(sessionId)) {
      return NextResponse.json({ error: "This session belongs to a locked payroll period." }, { status: 409 });
    }

    const deleteAllocationsResult = await adminSupabase
      .from("worker_payment_allocations")
      .delete()
      .eq("attendance_session_id", sessionId);
    if (deleteAllocationsResult.error) {
      return NextResponse.json({ error: toHebrewError(deleteAllocationsResult.error.message) }, { status: 400 });
    }

    const deleteResult = await adminSupabase.from(WORK_SESSIONS_TABLE).delete().eq("id", sessionId);
    if (deleteResult.error) {
      return NextResponse.json({ error: toHebrewError(deleteResult.error.message) }, { status: 400 });
    }

    const workerResult = await supabase
      .from("users")
      .select("id,payroll_worker_type,pay_tracking_mode")
      .eq("id", sessionResult.data.user_id)
      .maybeSingle();

    if (workerResult.error) {
      return NextResponse.json({ error: toHebrewError(workerResult.error.message) }, { status: 400 });
    }

    const workerType = normalizePayrollWorkerType(
      workerResult.data?.payroll_worker_type ?? null,
      workerResult.data?.pay_tracking_mode ?? "session"
    );

    await recalculateUserSessionCostsFromRules(supabase, sessionResult.data.user_id ?? "", {
      fromDate: sessionResult.data.clock_in.slice(0, 10),
      regeneratePayslips: payrollWorkerTypeGeneratesPayslips(workerType),
    });

    await logAuditEvent({
      supabase,
      tableName: WORK_SESSIONS_TABLE,
      recordId: sessionId,
      action: "delete",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
