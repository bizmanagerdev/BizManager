import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isPayrollAdminPasswordConfigured, isPayrollAdminUnlocked } from "@/lib/payroll-admin-auth";
import type { SalaryAgreementRow } from "@/lib/payroll";

type SalaryAgreementPayload = {
  user_id?: string;
  salary_type?: string;
  hourly_rate?: number | string | null;
  monthly_salary?: number | string | null;
  valid_from?: string;
  notes?: string | null;
  overtime_rate?: number | string | null;
  standard_daily_hours?: number | string | null;
};

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function dayBefore(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function overlapsAgreement(startDate: string, endDate: string | null, other: SalaryAgreementRow) {
  const start = new Date(`${startDate}T00:00:00`).getTime();
  const end = endDate
    ? new Date(`${endDate}T23:59:59.999`).getTime()
    : Number.POSITIVE_INFINITY;
  const otherStart = new Date(`${other.valid_from}T00:00:00`).getTime();
  const otherEnd = other.valid_to
    ? new Date(`${other.valid_to}T23:59:59.999`).getTime()
    : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(start) || !Number.isFinite(otherStart)) return false;
  return start <= otherEnd && otherStart <= end;
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

    const body = (await req.json().catch(() => ({}))) as SalaryAgreementPayload;
    const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const salaryType = body.salary_type === "hourly" || body.salary_type === "monthly" ? body.salary_type : "";
    const validFrom = typeof body.valid_from === "string" ? body.valid_from.trim() : "";
    const hourlyRate = toNullableNumber(body.hourly_rate);
    const monthlySalary = toNullableNumber(body.monthly_salary);
    const overtimeRate = toNullableNumber(body.overtime_rate);
    const standardDailyHours = toNullableNumber(body.standard_daily_hours);
    const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;

    if (!userId || !salaryType || !validFrom) {
      return NextResponse.json({ error: "User, salary type, and valid-from are required." }, { status: 400 });
    }
    if (salaryType === "hourly" && (hourlyRate === null || hourlyRate <= 0)) {
      return NextResponse.json({ error: "Hourly rate is required for hourly agreements." }, { status: 400 });
    }
    if (salaryType === "monthly" && (monthlySalary === null || monthlySalary <= 0)) {
      return NextResponse.json({ error: "Monthly salary is required for monthly agreements." }, { status: 400 });
    }
    if (standardDailyHours === null || standardDailyHours <= 0) {
      return NextResponse.json({ error: "Standard daily hours are required." }, { status: 400 });
    }

    const { supabase } = access.value;
    const agreementsResult = await supabase
      .from("salary_agreements")
      .select(
        "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours"
      )
      .eq("user_id", userId)
      .order("valid_from", { ascending: false });

    if (agreementsResult.error) {
      return NextResponse.json({ error: agreementsResult.error.message }, { status: 400 });
    }

    const agreements = (agreementsResult.data ?? []) as SalaryAgreementRow[];
    const previousActive = agreements.find((agreement) => !agreement.valid_to && agreement.valid_from <= validFrom) ?? null;
    const previousValidTo = previousActive ? dayBefore(validFrom) : null;

    const futureOverlap = agreements.find((agreement) => {
      const endDate = previousValidTo;
      if (previousActive && agreement.id === previousActive.id) return false;
      return overlapsAgreement(validFrom, endDate, agreement);
    });

    if (futureOverlap) {
      return NextResponse.json({ error: "Salary agreements cannot overlap for the same worker." }, { status: 409 });
    }

    if (previousActive && previousValidTo) {
      const closeResult = await supabase
        .from("salary_agreements")
        .update({ valid_to: previousValidTo })
        .eq("id", previousActive.id);

      if (closeResult.error) {
        return NextResponse.json({ error: closeResult.error.message }, { status: 400 });
      }
    }

    const insertResult = await supabase
      .from("salary_agreements")
      .insert({
        user_id: userId,
        salary_type: salaryType,
        hourly_rate: salaryType === "hourly" ? hourlyRate : null,
        monthly_salary: salaryType === "monthly" ? monthlySalary : null,
        valid_from: validFrom,
        valid_to: null,
        notes,
        overtime_rate: overtimeRate,
        standard_daily_hours: standardDailyHours,
      })
      .select(
        "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours"
      )
      .maybeSingle();

    if (insertResult.error) {
      return NextResponse.json({ error: insertResult.error.message }, { status: 400 });
    }

    return NextResponse.json({ agreement: insertResult.data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
