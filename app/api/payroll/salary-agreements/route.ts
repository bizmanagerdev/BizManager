import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isPayrollAdminUnlocked, isPayrollAdminPasswordConfigured } from "@/lib/payroll-admin-auth";

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

function toNullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dayBefore(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;

    if (!isPayrollAdminPasswordConfigured()) {
      return NextResponse.json(
        { error: "PAYROLL_ADMIN_PASSWORD is not configured on the server." },
        { status: 500 }
      );
    }

    if (!(await isPayrollAdminUnlocked())) {
      return NextResponse.json({ error: "יש לפתוח את מרכז השכר עם סיסמת מנהל." }, { status: 403 });
    }

    const body = (await req.json()) as SalaryAgreementPayload;
    const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const salaryType = typeof body.salary_type === "string" ? body.salary_type.trim() : "";
    const validFrom = typeof body.valid_from === "string" ? body.valid_from.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const hourlyRate = toNullableNumber(body.hourly_rate);
    const monthlySalary = toNullableNumber(body.monthly_salary);
    const overtimeRate = toNullableNumber(body.overtime_rate);
    const standardDailyHours = toNullableNumber(body.standard_daily_hours);

    if (!userId) {
      return NextResponse.json({ error: "חסר מזהה משתמש." }, { status: 400 });
    }
    if (salaryType !== "hourly" && salaryType !== "monthly") {
      return NextResponse.json({ error: "סוג השכר חייב להיות hourly או monthly." }, { status: 400 });
    }
    if (!validFrom) {
      return NextResponse.json({ error: "יש לבחור תאריך תחילה." }, { status: 400 });
    }
    if (salaryType === "hourly" && hourlyRate === null) {
      return NextResponse.json({ error: "יש להזין תעריף שעתי." }, { status: 400 });
    }
    if (salaryType === "monthly" && monthlySalary === null) {
      return NextResponse.json({ error: "יש להזין שכר חודשי." }, { status: 400 });
    }
    if (standardDailyHours === null) {
      return NextResponse.json({ error: "יש להזין שעות עבודה יומיות תקניות." }, { status: 400 });
    }

    const { supabase } = access.value;

    const { data: currentAgreement, error: currentAgreementError } = await supabase
      .from("salary_agreements")
      .select("id,valid_from,valid_to")
      .eq("user_id", userId)
      .order("valid_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (currentAgreementError) {
      return NextResponse.json({ error: currentAgreementError.message }, { status: 400 });
    }

    if (
      currentAgreement &&
      typeof currentAgreement.id === "string" &&
      typeof currentAgreement.valid_from === "string" &&
      currentAgreement.valid_from < validFrom &&
      !currentAgreement.valid_to
    ) {
      const previousValidTo = dayBefore(validFrom);
      if (previousValidTo) {
        const { error: closeError } = await supabase
          .from("salary_agreements")
          .update({ valid_to: previousValidTo })
          .eq("id", currentAgreement.id);

        if (closeError) {
          return NextResponse.json({ error: closeError.message }, { status: 400 });
        }
      }
    }

    const { data, error } = await supabase
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

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ agreement: data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
