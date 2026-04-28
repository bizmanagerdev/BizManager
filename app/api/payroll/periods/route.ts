import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import {
  buildPeriodBounds,
  generatePayslipsForPeriod,
  isPayrollPeriodEditable,
  normalizePayrollStatus,
  type SalaryCenterUserRow,
} from "@/lib/payroll-center";
import type { PayrollPeriodRow } from "@/lib/payroll";
import { isPayrollAdminPasswordConfigured, isPayrollAdminUnlocked } from "@/lib/payroll-admin-auth";

type PeriodPayload = {
  action?: string;
  period_id?: string;
  period_month?: string;
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;

    if (!isPayrollAdminPasswordConfigured()) {
      return NextResponse.json(
        { error: "Salary area password is not configured on the server." },
        { status: 500 }
      );
    }

    if (!(await isPayrollAdminUnlocked())) {
      return NextResponse.json({ error: "Salary area is locked." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as PeriodPayload;
    const action = typeof body.action === "string" ? body.action.trim() : "";
    const periodId = typeof body.period_id === "string" ? body.period_id.trim() : "";
    const periodMonth = typeof body.period_month === "string" ? body.period_month.trim() : "";
    const { supabase } = access.value;

    if (action === "create") {
      const bounds = buildPeriodBounds(periodMonth);
      if (!periodMonth || !bounds) {
        return NextResponse.json({ error: "Valid period_month is required." }, { status: 400 });
      }

      const existing = await supabase
        .from("payroll_periods")
        .select("id,period_month,start_date,end_date,status")
        .eq("period_month", periodMonth)
        .maybeSingle();

      if (existing.error) {
        return NextResponse.json({ error: existing.error.message }, { status: 400 });
      }

      if (existing.data) {
        if (normalizePayrollStatus(existing.data.status) === "open") {
          return NextResponse.json({ period: existing.data });
        }

        const reopened = await supabase
          .from("payroll_periods")
          .update({ status: "open" })
          .eq("id", existing.data.id)
          .select("id,period_month,start_date,end_date,status")
          .maybeSingle();

        if (reopened.error) {
          return NextResponse.json({ error: reopened.error.message }, { status: 400 });
        }

        return NextResponse.json({ period: reopened.data });
      }

      const insertResult = await supabase
        .from("payroll_periods")
        .insert({
          period_month: periodMonth,
          start_date: bounds.startDate,
          end_date: bounds.endDate,
          status: "open",
        })
        .select("id,period_month,start_date,end_date,status")
        .maybeSingle();

      if (insertResult.error) {
        return NextResponse.json({ error: insertResult.error.message }, { status: 400 });
      }

      return NextResponse.json({ period: insertResult.data });
    }

    if (!periodId) {
      return NextResponse.json({ error: "period_id is required." }, { status: 400 });
    }

    const periodResult = await supabase
      .from("payroll_periods")
      .select("id,period_month,start_date,end_date,status")
      .eq("id", periodId)
      .maybeSingle();

    if (periodResult.error) {
      return NextResponse.json({ error: periodResult.error.message }, { status: 400 });
    }
    if (!periodResult.data) {
      return NextResponse.json({ error: "Payroll period not found." }, { status: 404 });
    }

    const period = periodResult.data as PayrollPeriodRow;

    if (action === "generate") {
      if (!isPayrollPeriodEditable(period.status)) {
        return NextResponse.json({ error: "Locked or paid periods cannot be regenerated." }, { status: 409 });
      }

      const usersResult = await supabase
        .from("users")
        .select("id,full_name,email,phone,role,active,system_access")
        .in("role", ["admin", "office", "worker"])
        .range(0, 999);

      if (usersResult.error) {
        return NextResponse.json({ error: usersResult.error.message }, { status: 400 });
      }

      const generated = await generatePayslipsForPeriod(
        supabase,
        period,
        (usersResult.data ?? []) as SalaryCenterUserRow[]
      );
      return NextResponse.json(generated);
    }

    if (action === "lock" || action === "mark_paid") {
      const nextStatus = action === "mark_paid" ? "paid" : "locked";
      const updateResult = await supabase
        .from("payroll_periods")
        .update({ status: nextStatus })
        .eq("id", period.id)
        .select("id,period_month,start_date,end_date,status")
        .maybeSingle();

      if (updateResult.error) {
        return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
      }

      return NextResponse.json({ period: updateResult.data });
    }

    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
