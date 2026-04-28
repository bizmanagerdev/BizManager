import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { collectLockedSessionIds } from "@/lib/payroll-center";
import {
  calculateSessionLaborCost,
  getCurrentSalaryAgreement,
  minutesBetween,
  type PayrollPeriodRow,
  type SalaryAgreementRow,
  WORK_SESSIONS_TABLE,
} from "@/lib/payroll";

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as {
      session_id?: string;
      clock_out?: string | null;
    };
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    const clockOut = typeof body.clock_out === "string" && body.clock_out.trim() ? body.clock_out.trim() : new Date().toISOString();

    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id." }, { status: 400 });
    }

    const { supabase } = access.value;
    const [sessionResult, periodsResult] = await Promise.all([
      supabase
        .from(WORK_SESSIONS_TABLE)
        .select("id,user_id,clock_in,clock_out")
        .eq("id", sessionId)
        .maybeSingle(),
      supabase.from("payroll_periods").select("id,period_month,start_date,end_date,status").range(0, 119),
    ]);

    if (sessionResult.error) return NextResponse.json({ error: sessionResult.error.message }, { status: 400 });
    if (periodsResult.error) return NextResponse.json({ error: periodsResult.error.message }, { status: 400 });
    if (!sessionResult.data) return NextResponse.json({ error: "Session not found." }, { status: 404 });

    const lockedIds = collectLockedSessionIds([sessionResult.data], (periodsResult.data ?? []) as PayrollPeriodRow[]);
    if (lockedIds.has(sessionId)) {
      return NextResponse.json({ error: "This session belongs to a locked payroll period." }, { status: 409 });
    }
    if (sessionResult.data.clock_out) {
      return NextResponse.json({ error: "Session is already closed." }, { status: 400 });
    }

    const start = new Date(sessionResult.data.clock_in);
    const end = new Date(clockOut);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return NextResponse.json({ error: "Clock-out must be after clock-in." }, { status: 400 });
    }

    const agreementsResult = await supabase
      .from("salary_agreements")
      .select(
        "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours"
      )
      .eq("user_id", sessionResult.data.user_id)
      .order("valid_from", { ascending: false });

    if (agreementsResult.error) {
      return NextResponse.json({ error: agreementsResult.error.message }, { status: 400 });
    }

    const workedMinutes = minutesBetween(sessionResult.data.clock_in, clockOut);
    const agreement = getCurrentSalaryAgreement(
      ((agreementsResult.data ?? []) as SalaryAgreementRow[]),
      new Date(sessionResult.data.clock_in)
    );
    const laborCost = calculateSessionLaborCost(agreement, workedMinutes);

    const updateResult = await supabase
      .from(WORK_SESSIONS_TABLE)
      .update({
        clock_out: clockOut,
        worked_minutes: workedMinutes,
        labor_cost: laborCost,
      })
      .eq("id", sessionId)
      .select(
        "id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id"
      )
      .maybeSingle();

    if (updateResult.error) {
      return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
    }

    return NextResponse.json({ session: updateResult.data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
