import { toHebrewError } from "@/lib/error-messages";
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

type PeriodPayload = {
  action?: string;
  period_id?: string;
  period_month?: string;
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;

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
        return NextResponse.json({ error: toHebrewError(existing.error.message) }, { status: 400 });
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
          return NextResponse.json({ error: toHebrewError(reopened.error.message) }, { status: 400 });
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
        return NextResponse.json({ error: toHebrewError(insertResult.error.message) }, { status: 400 });
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
      return NextResponse.json({ error: toHebrewError(periodResult.error.message) }, { status: 400 });
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
        .select("id,full_name,email,phone,role,active,system_access,payroll_worker_type,pay_tracking_mode")
        .in("role", ["admin", "office", "worker", "worker_no_access"])
        .range(0, 999);

      if (usersResult.error) {
        return NextResponse.json({ error: toHebrewError(usersResult.error.message) }, { status: 400 });
      }

      const generated = await generatePayslipsForPeriod(
        supabase,
        period,
        (usersResult.data ?? []) as SalaryCenterUserRow[]
      );
      return NextResponse.json(generated);
    }

    if (action === "mark_paid") {
      return NextResponse.json(
        { error: "Use worker payments to record actual payroll payments. Period status is no longer the payment source of truth." },
        { status: 409 }
      );
    }

    if (action === "lock") {
      const nextStatus = "locked";
      const updateResult = await supabase
        .from("payroll_periods")
        .update({ status: nextStatus })
        .eq("id", period.id)
        .select("id,period_month,start_date,end_date,status")
        .maybeSingle();

      if (updateResult.error) {
        return NextResponse.json({ error: toHebrewError(updateResult.error.message) }, { status: 400 });
      }

      return NextResponse.json({ period: updateResult.data });
    }

    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
