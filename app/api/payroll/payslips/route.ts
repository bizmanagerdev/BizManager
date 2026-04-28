import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import {
  generatePayslipsForPeriod,
  isPayrollPeriodEditable,
  type SalaryCenterUserRow,
} from "@/lib/payroll-center";
import type { PayrollPeriodRow } from "@/lib/payroll";
import { isPayrollAdminPasswordConfigured, isPayrollAdminUnlocked } from "@/lib/payroll-admin-auth";

type PayslipPayload = {
  action?: string;
  payroll_period_id?: string;
  payslip_id?: string;
  user_id?: string;
  manual_adjustments?: number | string | null;
  notes?: string | null;
};

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

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

    const body = (await req.json().catch(() => ({}))) as PayslipPayload;
    const action = typeof body.action === "string" ? body.action.trim() : "";
    const { supabase } = access.value;

    if (action === "generate") {
      const periodId = typeof body.payroll_period_id === "string" ? body.payroll_period_id.trim() : "";
      const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
      if (!periodId) {
        return NextResponse.json({ error: "payroll_period_id is required." }, { status: 400 });
      }

      const [periodResult, usersResult] = await Promise.all([
        supabase
          .from("payroll_periods")
          .select("id,period_month,start_date,end_date,status")
          .eq("id", periodId)
          .maybeSingle(),
        supabase
          .from("users")
          .select("id,full_name,email,phone,role,active,system_access")
          .in("role", ["admin", "office", "worker"])
          .range(0, 999),
      ]);

      if (periodResult.error) return NextResponse.json({ error: periodResult.error.message }, { status: 400 });
      if (usersResult.error) return NextResponse.json({ error: usersResult.error.message }, { status: 400 });
      if (!periodResult.data) return NextResponse.json({ error: "Payroll period not found." }, { status: 404 });
      if (!isPayrollPeriodEditable(periodResult.data.status)) {
        return NextResponse.json({ error: "Locked or paid periods cannot be regenerated." }, { status: 409 });
      }

      const generated = await generatePayslipsForPeriod(
        supabase,
        periodResult.data as PayrollPeriodRow,
        (usersResult.data ?? []) as SalaryCenterUserRow[],
        userId || undefined
      );

      return NextResponse.json(generated);
    }

    if (action === "update") {
      const payslipId = typeof body.payslip_id === "string" ? body.payslip_id.trim() : "";
      if (!payslipId) {
        return NextResponse.json({ error: "payslip_id is required." }, { status: 400 });
      }

      const payslipResult = await supabase
        .from("payslips")
        .select(
          "id,payroll_period_id,user_id,calculated_salary_type,total_work_minutes,calculated_base_salary,manual_adjustments,gross_salary,notes"
        )
        .eq("id", payslipId)
        .maybeSingle();

      if (payslipResult.error) {
        return NextResponse.json({ error: payslipResult.error.message }, { status: 400 });
      }
      if (!payslipResult.data) {
        return NextResponse.json({ error: "Payslip not found." }, { status: 404 });
      }

      const periodResult = await supabase
        .from("payroll_periods")
        .select("id,period_month,start_date,end_date,status")
        .eq("id", payslipResult.data.payroll_period_id)
        .maybeSingle();

      if (periodResult.error) return NextResponse.json({ error: periodResult.error.message }, { status: 400 });
      if (!periodResult.data || !isPayrollPeriodEditable(periodResult.data.status)) {
        return NextResponse.json({ error: "Only open payroll periods can be edited." }, { status: 409 });
      }

      const itemsResult = await supabase
        .from("payslip_items")
        .select("amount")
        .eq("payslip_id", payslipId)
        .range(0, 999);

      if (itemsResult.error) return NextResponse.json({ error: itemsResult.error.message }, { status: 400 });

      const manualAdjustments = toNullableNumber(body.manual_adjustments) ?? 0;
      const itemTotal = ((itemsResult.data ?? []) as Array<{ amount: number | string | null }>).reduce(
        (sum, item) => sum + (toNullableNumber(item.amount) ?? 0),
        0
      );
      const grossSalary =
        (toNullableNumber(payslipResult.data.calculated_base_salary) ?? 0) + manualAdjustments + itemTotal;

      const updateResult = await supabase
        .from("payslips")
        .update({
          manual_adjustments: manualAdjustments,
          gross_salary: grossSalary,
          notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
        })
        .eq("id", payslipId)
        .select(
          "id,payroll_period_id,user_id,calculated_salary_type,total_work_minutes,calculated_base_salary,manual_adjustments,gross_salary,notes"
        )
        .maybeSingle();

      if (updateResult.error) {
        return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
      }

      return NextResponse.json({ payslip: updateResult.data });
    }

    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
