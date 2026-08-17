import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { buildSalariedHoursWorkbook, buildPeriodMonthBounds } from "@/lib/payroll-salaried-export";
import type { SalaryAgreementRow, WorkSessionRow } from "@/lib/payroll";
import { WORKER_ABSENCE_COLUMNS, WORKER_ABSENCES_TABLE, type WorkerAbsenceRow } from "@/lib/payroll-bonuses";

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  active: boolean | null;
};

function normalizePeriodMonth(value: string | null) {
  const trimmed = value?.trim() ?? "";
  if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function filenameForPeriod(periodMonth: string) {
  return `salaried-hours-${periodMonth}.xls`;
}

export async function GET(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;

    const url = new URL(req.url);
    const periodMonth = normalizePeriodMonth(url.searchParams.get("period_month"));
    const bounds = buildPeriodMonthBounds(periodMonth);
    if (!bounds) {
      return new Response(JSON.stringify({ error: "Invalid period_month." }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const { supabase } = access.value;
    const usersResult = await supabase
      .from("users")
      .select("id,full_name,email,role,active")
      .or("role.eq.admin,role.eq.office,role.eq.worker,role.eq.worker_no_access")
      .eq("active", true)
      .order("full_name", { ascending: true })
      .range(0, 999);

    if (usersResult.error) {
      return new Response(JSON.stringify({ error: toHebrewError(usersResult.error.message) }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const users = ((usersResult.data ?? []) as UserRow[]).filter((user) => user.id);
    const userIds = users.map((user) => user.id);

    const [agreementsResult, sessionsResult, absencesResult] = await Promise.all([
      supabase
        .from("salary_agreements")
        .select(
          "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours"
        )
        .in("user_id", userIds)
        .order("valid_from", { ascending: false }),
      supabase
        .from("attendance_sessions")
        .select(
          "id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id"
        )
        .in("user_id", userIds)
        .gte("clock_in", `${bounds.startDate}T00:00:00`)
        .lte("clock_in", `${bounds.endDate}T23:59:59.999`)
        .range(0, 9999),
      supabase
        .from(WORKER_ABSENCES_TABLE)
        .select(WORKER_ABSENCE_COLUMNS)
        .in("user_id", userIds)
        .gte("absence_date", bounds.startDate)
        .lte("absence_date", bounds.endDate)
        .range(0, 4999),
    ]);

    if (agreementsResult.error) {
      return new Response(JSON.stringify({ error: toHebrewError(agreementsResult.error.message) }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    if (sessionsResult.error) {
      return new Response(JSON.stringify({ error: toHebrewError(sessionsResult.error.message) }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // Tolerant on purpose: until the bonuses/absences migration is applied the
    // table doesn't exist, and an hours sheet without the days-off column still
    // beats a failed download.
    const absences = absencesResult.error ? [] : ((absencesResult.data ?? []) as WorkerAbsenceRow[]);

    const workbook = buildSalariedHoursWorkbook(
      periodMonth,
      users,
      (agreementsResult.data ?? []) as SalaryAgreementRow[],
      (sessionsResult.data ?? []) as WorkSessionRow[],
      absences
    );

    return new Response(workbook, {
      status: 200,
      headers: {
        "content-type": "application/vnd.ms-excel; charset=utf-8",
        "content-disposition": `attachment; filename="${filenameForPeriod(periodMonth)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
