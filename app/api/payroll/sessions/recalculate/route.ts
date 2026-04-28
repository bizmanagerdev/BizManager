import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { collectLockedSessionIds } from "@/lib/payroll-center";
import {
  calculateSessionLaborCost,
  getCurrentSalaryAgreement,
  sessionWorkedMinutes,
  type PayrollPeriodRow,
  type SalaryAgreementRow,
  type WorkSessionRow,
  WORK_SESSIONS_TABLE,
} from "@/lib/payroll";
import { isPayrollAdminUnlocked } from "@/lib/payroll-admin-auth";

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;

    if (!(await isPayrollAdminUnlocked())) {
      return NextResponse.json({ error: "Salary area is locked." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { session_id?: string };
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id." }, { status: 400 });
    }

    const { supabase } = access.value;
    const [sessionResult, periodsResult] = await Promise.all([
      supabase
        .from(WORK_SESSIONS_TABLE)
        .select(
          "id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id"
        )
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

    const session = sessionResult.data as WorkSessionRow;
    const agreement = getCurrentSalaryAgreement(
      ((agreementsResult.data ?? []) as SalaryAgreementRow[]),
      new Date(session.clock_in)
    );
    const laborCost = calculateSessionLaborCost(agreement, sessionWorkedMinutes(session));

    const updateResult = await supabase
      .from(WORK_SESSIONS_TABLE)
      .update({ labor_cost: laborCost })
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
