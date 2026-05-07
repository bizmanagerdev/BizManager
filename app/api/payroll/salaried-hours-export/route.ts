import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { buildSalariedHoursWorkbook, buildPeriodMonthBounds } from "@/lib/payroll-salaried-export";
import type { SalaryAgreementRow, WorkSessionRow } from "@/lib/payroll";

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
      return new Response(JSON.stringify({ error: usersResult.error.message }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const users = ((usersResult.data ?? []) as UserRow[]).filter((user) => user.id);
    const userIds = users.map((user) => user.id);

    const [agreementsResult, sessionsResult] = await Promise.all([
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
    ]);

    if (agreementsResult.error) {
      return new Response(JSON.stringify({ error: agreementsResult.error.message }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    if (sessionsResult.error) {
      return new Response(JSON.stringify({ error: sessionsResult.error.message }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const workbook = buildSalariedHoursWorkbook(
      periodMonth,
      users,
      (agreementsResult.data ?? []) as SalaryAgreementRow[],
      (sessionsResult.data ?? []) as WorkSessionRow[]
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
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
