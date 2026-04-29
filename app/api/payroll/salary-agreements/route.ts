import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { recalculateUserSessionCostsFromRules } from "@/lib/payroll-center";
import type { SalaryAgreementRow } from "@/lib/payroll";

type SalaryAgreementPayload = {
  agreement_id?: string;
  user_id?: string;
  action?: string;
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
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - 1);
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
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

async function normalizeAgreementRanges(
  supabase: Awaited<ReturnType<typeof requireRouteAccess>> extends { ok: true; value: infer V }
    ? V["supabase"]
    : never,
  agreements: SalaryAgreementRow[]
) {
  const sortedAscending = [...agreements].sort((a, b) => a.valid_from.localeCompare(b.valid_from));

  for (let index = 0; index < sortedAscending.length; index += 1) {
    const agreement = sortedAscending[index];
    const nextAgreement = index < sortedAscending.length - 1 ? sortedAscending[index + 1] : null;
    const expectedValidTo = nextAgreement ? dayBefore(nextAgreement.valid_from) : null;

    if ((agreement.valid_to ?? null) === expectedValidTo) continue;

    const updateResult = await supabase
      .from("salary_agreements")
      .update({ valid_to: expectedValidTo })
      .eq("id", agreement.id);

    if (updateResult.error) {
      throw new Error(updateResult.error.message);
    }
  }
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as SalaryAgreementPayload;
    const agreementId = typeof body.agreement_id === "string" ? body.agreement_id.trim() : "";
    const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const action = typeof body.action === "string" ? body.action.trim() : "";
    const salaryType = body.salary_type === "hourly" || body.salary_type === "monthly" ? body.salary_type : "";
    const validFrom = typeof body.valid_from === "string" ? body.valid_from.trim() : "";
    const hourlyRate = toNullableNumber(body.hourly_rate);
    const monthlySalary = toNullableNumber(body.monthly_salary);
    const overtimeRate = toNullableNumber(body.overtime_rate);
    const standardDailyHours = toNullableNumber(body.standard_daily_hours);
    const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;

    if (action === "delete") {
      if (!agreementId || !userId) {
        return NextResponse.json({ error: "Agreement and user are required." }, { status: 400 });
      }
    } else if (!userId || !salaryType || !validFrom) {
      return NextResponse.json({ error: "User, salary type, and valid-from are required." }, { status: 400 });
    }
    if (action !== "delete" && salaryType === "hourly" && (hourlyRate === null || hourlyRate <= 0)) {
      return NextResponse.json({ error: "Hourly rate is required for hourly agreements." }, { status: 400 });
    }
    if (action !== "delete" && salaryType === "monthly" && (monthlySalary === null || monthlySalary <= 0)) {
      return NextResponse.json({ error: "Monthly salary is required for monthly agreements." }, { status: 400 });
    }
    if (action !== "delete" && (standardDailyHours === null || standardDailyHours <= 0)) {
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

    if (action === "delete") {
      const targetAgreement = agreements.find((agreement) => agreement.id === agreementId) ?? null;
      if (!targetAgreement) {
        return NextResponse.json({ error: "Salary agreement not found." }, { status: 404 });
      }

      const deleteResult = await supabase.from("salary_agreements").delete().eq("id", agreementId);
      if (deleteResult.error) {
        return NextResponse.json({ error: deleteResult.error.message }, { status: 400 });
      }

      const remainingAgreements = agreements.filter((agreement) => agreement.id !== agreementId);
      await normalizeAgreementRanges(supabase, remainingAgreements);

      await recalculateUserSessionCostsFromRules(supabase, userId, { fromDate: targetAgreement.valid_from });

      return NextResponse.json({ success: true });
    }

    if (agreementId) {
      const targetAgreement = agreements.find((agreement) => agreement.id === agreementId) ?? null;
      if (!targetAgreement) {
        return NextResponse.json({ error: "Salary agreement not found." }, { status: 404 });
      }

      const overlap = agreements.find((agreement) => {
        if (agreement.id === agreementId) return false;
        return overlapsAgreement(validFrom, targetAgreement.valid_to, agreement);
      });

      if (overlap) {
        return NextResponse.json({ error: "Salary agreements cannot overlap for the same worker." }, { status: 409 });
      }

      const updateResult = await supabase
        .from("salary_agreements")
        .update({
          salary_type: salaryType,
          hourly_rate: salaryType === "hourly" ? hourlyRate : null,
          monthly_salary: salaryType === "monthly" ? monthlySalary : null,
          valid_from: validFrom,
          notes,
          overtime_rate: overtimeRate,
          standard_daily_hours: standardDailyHours,
        })
        .eq("id", agreementId)
        .select(
          "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours"
        )
        .maybeSingle();

      if (updateResult.error) {
        return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
      }

      const refreshedAgreementsResult = await supabase
        .from("salary_agreements")
        .select(
          "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours"
        )
        .eq("user_id", userId)
        .order("valid_from", { ascending: false });

      if (refreshedAgreementsResult.error) {
        return NextResponse.json({ error: refreshedAgreementsResult.error.message }, { status: 400 });
      }

      const refreshedAgreements = (refreshedAgreementsResult.data ?? []) as SalaryAgreementRow[];
      await normalizeAgreementRanges(supabase, refreshedAgreements);

      const normalizedAgreementResult = await supabase
        .from("salary_agreements")
        .select(
          "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours"
        )
        .eq("id", agreementId)
        .maybeSingle();

      if (normalizedAgreementResult.error) {
        return NextResponse.json({ error: normalizedAgreementResult.error.message }, { status: 400 });
      }

      await recalculateUserSessionCostsFromRules(supabase, userId, { fromDate: validFrom });

      return NextResponse.json({ agreement: normalizedAgreementResult.data });
    }

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

    const insertedAgreement = insertResult.data as SalaryAgreementRow | null;
    const normalizedAgreements = insertedAgreement ? [...agreements, insertedAgreement] : agreements;
    await normalizeAgreementRanges(supabase, normalizedAgreements);

    const normalizedInsertResult = insertedAgreement
      ? await supabase
          .from("salary_agreements")
          .select(
            "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours"
          )
          .eq("id", insertedAgreement.id)
          .maybeSingle()
      : { data: null, error: null };

    if (normalizedInsertResult.error) {
      return NextResponse.json({ error: normalizedInsertResult.error.message }, { status: 400 });
    }

    await recalculateUserSessionCostsFromRules(supabase, userId, { fromDate: validFrom });

    return NextResponse.json({ agreement: normalizedInsertResult.data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
