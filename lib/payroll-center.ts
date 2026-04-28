import type { ExpenseBusinessDomain } from "@/lib/expenses";
import {
  calculateSessionLaborCost,
  monthKeyFromDate,
  sessionWorkedMinutes,
  toNumber,
  type PayrollPeriodRow,
  type PayslipRow,
  type SalaryAgreementRow,
  type WorkSessionRow,
} from "@/lib/payroll";

export type SalaryCenterUserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  active: boolean | null;
  system_access: boolean | null;
};

export type SalaryCenterProjectOption = {
  id: string;
  label: string;
};

export type SessionPublicRow = Omit<WorkSessionRow, "labor_cost"> & {
  locked?: boolean;
};

export type SessionCostRow = {
  id: string;
  labor_cost: number | string | null;
};

export type HourlySalaryOverrideRow = {
  id: string;
  user_id: string;
  override_hourly_rate: number | string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type PayslipItemRow = {
  id: string;
  payslip_id: string;
  item_type: string | null;
  amount: number | string | null;
  notes: string | null;
};

export type SalaryCenterProtectedPayload = {
  agreements: SalaryAgreementRow[];
  periods: PayrollPeriodRow[];
  payslips: PayslipRow[];
  payslipItems: PayslipItemRow[];
  hourlyOverrides: HourlySalaryOverrideRow[];
  sessionCosts: SessionCostRow[];
  summary: {
    totalLaborCostThisMonth: number;
    unpaidOrUnfinishedPayslips: number;
  };
};

export function isSalaryTrackedWorker(
  user: Pick<SalaryCenterUserRow, "role">
) {
  return user.role === "worker" || user.role === "office" || user.role === "admin";
}

export type GeneratePayslipsResult = {
  payslips: PayslipRow[];
};

type SupabaseLike = {
  from: (table: string) => unknown;
};

type QueryLike = {
  select: (query: string) => QueryLike;
  insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => QueryLike;
  update: (payload: Record<string, unknown>) => QueryLike;
  in: (column: string, values: string[]) => QueryLike;
  eq: (column: string, value: string) => QueryLike;
  gte: (column: string, value: string) => QueryLike;
  lte: (column: string, value: string) => QueryLike;
  order: (column: string, options?: { ascending?: boolean }) => QueryLike;
  range: (from: number, to: number) => QueryLike;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
  then: Promise<{ data: unknown[] | Record<string, unknown> | null; error: { message: string } | null }>["then"];
};

function query(builder: unknown) {
  return builder as QueryLike;
}

export function normalizePayrollStatus(value: string | null | undefined) {
  if (!value) return "open";
  if (value === "paid") return "paid";
  if (value === "locked" || value === "closed" || value === "approved") return "locked";
  return "open";
}

export function isPayrollPeriodEditable(value: string | null | undefined) {
  return normalizePayrollStatus(value) === "open";
}

export function isPayrollPeriodLocked(value: string | null | undefined) {
  return normalizePayrollStatus(value) !== "open";
}

export function getCurrentMonthKey(referenceDate = new Date()) {
  return monthKeyFromDate(referenceDate);
}

export function getCurrentPayrollPeriod(periods: PayrollPeriodRow[], referenceDate = new Date()) {
  const key = getCurrentMonthKey(referenceDate);
  const exact = periods.find((period) => period.period_month === key);
  if (exact) return exact;
  return [...periods].sort((a, b) => b.period_month.localeCompare(a.period_month))[0] ?? null;
}

export function isSessionInPeriod(session: Pick<WorkSessionRow, "clock_in">, period: PayrollPeriodRow) {
  const time = new Date(session.clock_in).getTime();
  const start = new Date(`${period.start_date}T00:00:00`).getTime();
  const end = new Date(`${period.end_date}T23:59:59.999`).getTime();
  return Number.isFinite(time) && Number.isFinite(start) && Number.isFinite(end) && time >= start && time <= end;
}

export function collectLockedSessionIds(
  sessions: Array<Pick<WorkSessionRow, "id" | "clock_in">>,
  periods: PayrollPeriodRow[]
) {
  const lockedPeriods = periods.filter((period) => isPayrollPeriodLocked(period.status));
  const lockedIds = new Set<string>();

  sessions.forEach((session) => {
    if (lockedPeriods.some((period) => isSessionInPeriod(session, period))) {
      lockedIds.add(session.id);
    }
  });

  return lockedIds;
}

export function getPayslipItemsTotal(items: PayslipItemRow[], payslipId: string) {
  return items
    .filter((item) => item.payslip_id === payslipId)
    .reduce((sum, item) => sum + toNumber(item.amount), 0);
}

export function getLatestHourlyOverride(
  overrides: HourlySalaryOverrideRow[],
  userId: string
) {
  return (
    [...overrides]
      .filter((override) => override.user_id === userId)
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0] ?? null
  );
}

export function getSessionLinkLabel(
  session: Pick<SessionPublicRow, "business_domain" | "project_id" | "property_id">,
  projectLabelsById: Map<string, string>,
  propertyLabelsById: Map<string, string>
) {
  if (session.business_domain === "logistics_projects" && session.project_id) {
    return projectLabelsById.get(session.project_id) ?? "פרויקט";
  }
  if (session.business_domain === "property_management" && session.property_id) {
    return propertyLabelsById.get(session.property_id) ?? "נכס";
  }
  if (session.business_domain === "sales") return "מכירות";
  if (session.business_domain === "home") return "בית";
  if (session.business_domain === "charity") return "צדקה";
  return "כללי";
}

export function getWorkerAccessLabel(user: Pick<SalaryCenterUserRow, "role" | "system_access">) {
  if (user.role === "worker_no_access" || user.system_access === false) return "ללא גישה";
  return "עם גישה";
}

export function getWorkerMonthStats(
  userId: string,
  sessions: SessionPublicRow[],
  monthKey = getCurrentMonthKey()
) {
  const scoped = sessions.filter((session) => session.user_id === userId && monthKeyFromDate(session.clock_in) === monthKey);
  const totalMinutes = scoped.reduce((sum, session) => sum + sessionWorkedMinutes(session), 0);
  const linkedIds = new Set(
    scoped
      .map((session) => session.project_id ?? session.property_id ?? "")
      .filter(Boolean)
  );

  return {
    totalMinutes,
    sessionCount: scoped.length,
    projectCount: linkedIds.size,
    openSessionCount: scoped.filter((session) => !session.clock_out).length,
  };
}

export function resolveSessionLaborCost(
  session: Pick<WorkSessionRow, "labor_cost" | "worked_minutes" | "clock_in" | "clock_out">,
  agreement: SalaryAgreementRow | null,
  override: HourlySalaryOverrideRow | null
) {
  const explicit = toNumber(session.labor_cost);
  if (explicit > 0) return explicit;

  const workedMinutes = sessionWorkedMinutes(session);
  if (workedMinutes <= 0 || !agreement) return 0;

  if (agreement.salary_type === "hourly" && override && toNumber(override.override_hourly_rate) > 0) {
    return Math.round(((toNumber(override.override_hourly_rate) * workedMinutes) / 60) * 100) / 100;
  }

  return toNumber(calculateSessionLaborCost(agreement, workedMinutes));
}

export function calculateSessionLaborCostFromRules(
  session: Pick<WorkSessionRow, "worked_minutes" | "clock_in" | "clock_out">,
  agreement: SalaryAgreementRow | null,
  override: HourlySalaryOverrideRow | null
) {
  const workedMinutes = sessionWorkedMinutes(session);
  if (workedMinutes <= 0 || !agreement) return 0;

  if (agreement.salary_type === "hourly" && override && toNumber(override.override_hourly_rate) > 0) {
    return Math.round(((toNumber(override.override_hourly_rate) * workedMinutes) / 60) * 100) / 100;
  }

  return toNumber(calculateSessionLaborCost(agreement, workedMinutes));
}

function sessionDateKey(clockIn: string) {
  const date = new Date(clockIn);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function calculateSessionLaborCostsByDay(
  sessions: Array<Pick<WorkSessionRow, "id" | "worked_minutes" | "clock_in" | "clock_out">>,
  agreements: SalaryAgreementRow[],
  override: HourlySalaryOverrideRow | null
) {
  const costsById = new Map<string, number>();
  const sessionsByDay = new Map<string, Array<Pick<WorkSessionRow, "id" | "worked_minutes" | "clock_in" | "clock_out">>>();

  sessions.forEach((session) => {
    if (!session.clock_out) {
      costsById.set(session.id, 0);
      return;
    }
    const key = sessionDateKey(session.clock_in);
    const list = sessionsByDay.get(key) ?? [];
    list.push(session);
    sessionsByDay.set(key, list);
  });

  sessionsByDay.forEach((daySessions) => {
    const orderedSessions = [...daySessions].sort((a, b) => a.clock_in.localeCompare(b.clock_in));
    let accumulatedMinutes = 0;

    orderedSessions.forEach((session) => {
      const agreement = getCurrentSalaryAgreement(agreements, new Date(session.clock_in));
      const workedMinutes = sessionWorkedMinutes(session);
      if (!agreement || workedMinutes <= 0) {
        costsById.set(session.id, 0);
        return;
      }

      if (agreement.salary_type === "hourly") {
        const overrideRate = toNumber(override?.override_hourly_rate);
        if (override && overrideRate > 0) {
          costsById.set(session.id, Math.round(((overrideRate * workedMinutes) / 60) * 100) / 100);
          accumulatedMinutes += workedMinutes;
          return;
        }

        const hourlyRate = toNumber(agreement.hourly_rate);
        const standardDailyHours = Math.max(0, toNumber(agreement.standard_daily_hours));
        const standardMinutes = standardDailyHours * 60;
        const overtimeRate = toNumber(agreement.overtime_rate);
        const effectiveOvertimeRate = overtimeRate > 0 ? overtimeRate : hourlyRate;
        const regularRemaining = Math.max(0, standardMinutes - accumulatedMinutes);
        const regularMinutes = Math.min(workedMinutes, regularRemaining);
        const overtimeMinutes = Math.max(0, workedMinutes - regularMinutes);
        costsById.set(
          session.id,
          Math.round((((hourlyRate * regularMinutes) + (effectiveOvertimeRate * overtimeMinutes)) / 60) * 100) / 100
        );
        accumulatedMinutes += workedMinutes;
        return;
      }

      costsById.set(session.id, toNumber(calculateSessionLaborCost(agreement, workedMinutes)));
      accumulatedMinutes += workedMinutes;
    });
  });

  return costsById;
}

export function buildPeriodBounds(periodMonth: string) {
  const [yearText, monthText] = periodMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function inferSessionBusinessDomain(
  businessDomain: string | null | undefined
): ExpenseBusinessDomain {
  if (
    businessDomain === "home" ||
    businessDomain === "charity" ||
    businessDomain === "general_business" ||
    businessDomain === "logistics_projects" ||
    businessDomain === "sales" ||
    businessDomain === "property_management"
  ) {
    return businessDomain;
  }
  return "general_business";
}

export async function fetchSalaryCenterProtectedPayload(
  supabase: SupabaseLike,
  userIds: string[],
  salaryTrackedUserIds: string[] = userIds
): Promise<SalaryCenterProtectedPayload> {
  const safeUserIds = userIds.filter(Boolean);
  const safeSalaryTrackedUserIds = salaryTrackedUserIds.filter(Boolean);
  const emptyPayload: SalaryCenterProtectedPayload = {
    agreements: [],
    periods: [],
    payslips: [],
    payslipItems: [],
    hourlyOverrides: [],
    sessionCosts: [],
    summary: {
      totalLaborCostThisMonth: 0,
      unpaidOrUnfinishedPayslips: 0,
    },
  };

  if (safeUserIds.length === 0) return emptyPayload;

  const [agreementsResult, periodsResult, payslipsResult, overridesResult, sessionCostsResult] = await Promise.all([
    query(supabase.from("salary_agreements"))
      .select(
        "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours"
      )
      .in("user_id", safeSalaryTrackedUserIds)
      .order("valid_from", { ascending: false }),
    query(supabase.from("payroll_periods"))
      .select("id,period_month,start_date,end_date,status")
      .order("period_month", { ascending: false })
      .range(0, 119),
    query(supabase.from("payslips"))
      .select(
        "id,payroll_period_id,user_id,calculated_salary_type,total_work_minutes,calculated_base_salary,manual_adjustments,gross_salary,notes"
      )
      .in("user_id", safeSalaryTrackedUserIds)
      .range(0, 1999),
    query(supabase.from("hourly_salary_overrides"))
      .select("id,user_id,override_hourly_rate,notes,created_at,updated_at")
      .in("user_id", safeSalaryTrackedUserIds)
      .order("created_at", { ascending: false })
      .range(0, 999),
    query(supabase.from("attendance_sessions"))
      .select("id,labor_cost,clock_in,user_id")
      .in("user_id", safeUserIds)
      .range(0, 4999),
  ]);

  if (agreementsResult.error) throw new Error(agreementsResult.error.message);
  if (periodsResult.error) throw new Error(periodsResult.error.message);
  if (payslipsResult.error) throw new Error(payslipsResult.error.message);
  if (overridesResult.error) throw new Error(overridesResult.error.message);
  if (sessionCostsResult.error) throw new Error(sessionCostsResult.error.message);

  const payslips = ((payslipsResult.data ?? []) as PayslipRow[]).filter((row) => row.id);
  const payslipIds = payslips.map((row) => row.id);
  const payslipItemsResult = payslipIds.length
    ? await query(supabase.from("payslip_items"))
        .select("id,payslip_id,item_type,amount,notes")
        .in("payslip_id", payslipIds)
        .range(0, 3999)
    : { data: [], error: null };

  if (payslipItemsResult.error) throw new Error(payslipItemsResult.error.message);

  const periods = (periodsResult.data ?? []) as PayrollPeriodRow[];
  const currentPeriod = getCurrentPayrollPeriod(periods);
  const totalLaborCostThisMonth = ((sessionCostsResult.data ?? []) as Array<SessionCostRow & { clock_in: string }>)
    .filter((session) => monthKeyFromDate(session.clock_in) === getCurrentMonthKey())
    .reduce((sum, session) => sum + toNumber(session.labor_cost), 0);

  let unpaidOrUnfinishedPayslips = 0;
  if (currentPeriod && normalizePayrollStatus(currentPeriod.status) !== "paid") {
    const existingUserIds = new Set(
      payslips
        .filter((payslip) => payslip.payroll_period_id === currentPeriod.id)
        .map((payslip) => payslip.user_id)
    );
    unpaidOrUnfinishedPayslips = safeSalaryTrackedUserIds.filter((userId) => !existingUserIds.has(userId)).length;
    unpaidOrUnfinishedPayslips += payslips.filter((payslip) => {
      const period = periods.find((row) => row.id === payslip.payroll_period_id);
      return period && normalizePayrollStatus(period.status) !== "paid";
    }).length;
  }

  return {
    agreements: (agreementsResult.data ?? []) as SalaryAgreementRow[],
    periods,
    payslips,
    payslipItems: (payslipItemsResult.data ?? []) as PayslipItemRow[],
    hourlyOverrides: (overridesResult.data ?? []) as HourlySalaryOverrideRow[],
    sessionCosts: ((sessionCostsResult.data ?? []) as Array<SessionCostRow & { user_id: string }>).map(
      (row) => ({
        id: row.id,
        labor_cost: row.labor_cost,
      })
    ),
    summary: {
      totalLaborCostThisMonth,
      unpaidOrUnfinishedPayslips,
    },
  };
}

export async function generatePayslipsForPeriod(
  supabase: SupabaseLike,
  period: PayrollPeriodRow,
  users: SalaryCenterUserRow[],
  targetUserId?: string
): Promise<GeneratePayslipsResult> {
  const eligibleUsers = users.filter((user) => {
    if (!user.id || user.active === false) return false;
    if (targetUserId && user.id !== targetUserId) return false;
    return isSalaryTrackedWorker(user);
  });

  if (eligibleUsers.length === 0) {
    return { payslips: [] };
  }

  const userIds = eligibleUsers.map((user) => user.id);
  const [sessionsResult, agreementsResult, existingPayslipsResult, overridesResult] = await Promise.all([
    query(supabase.from("attendance_sessions"))
      .select("id,user_id,clock_in,clock_out,worked_minutes,labor_cost")
      .in("user_id", userIds)
      .gte("clock_in", `${period.start_date}T00:00:00`)
      .lte("clock_in", `${period.end_date}T23:59:59.999`)
      .range(0, 4999),
    query(supabase.from("salary_agreements"))
      .select(
        "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours"
      )
      .in("user_id", userIds)
      .order("valid_from", { ascending: false }),
    query(supabase.from("payslips"))
      .select(
        "id,payroll_period_id,user_id,calculated_salary_type,total_work_minutes,calculated_base_salary,manual_adjustments,gross_salary,notes"
      )
      .eq("payroll_period_id", period.id)
      .in("user_id", userIds),
    query(supabase.from("hourly_salary_overrides"))
      .select("id,user_id,override_hourly_rate,notes,created_at,updated_at")
      .in("user_id", userIds)
      .order("created_at", { ascending: false }),
  ]);

  if (sessionsResult.error) throw new Error(sessionsResult.error.message);
  if (agreementsResult.error) throw new Error(agreementsResult.error.message);
  if (existingPayslipsResult.error) throw new Error(existingPayslipsResult.error.message);
  if (overridesResult.error) throw new Error(overridesResult.error.message);

  const sessions = (sessionsResult.data ?? []) as WorkSessionRow[];
  const agreements = (agreementsResult.data ?? []) as SalaryAgreementRow[];
  const existingPayslips = (existingPayslipsResult.data ?? []) as PayslipRow[];
  const overrides = (overridesResult.data ?? []) as HourlySalaryOverrideRow[];

  const existingPayslipIds = existingPayslips.map((row) => row.id);
  const itemsResult = existingPayslipIds.length
    ? await query(supabase.from("payslip_items"))
        .select("id,payslip_id,item_type,amount,notes")
        .in("payslip_id", existingPayslipIds)
        .range(0, 3999)
    : { data: [], error: null };

  if (itemsResult.error) throw new Error(itemsResult.error.message);

  const payslipItems = (itemsResult.data ?? []) as PayslipItemRow[];
  const createdOrUpdated: PayslipRow[] = [];

  for (const user of eligibleUsers) {
    const userSessions = sessions.filter((session) => session.user_id === user.id);
    const userAgreements = agreements.filter((agreement) => agreement.user_id === user.id);
    const currentAgreement =
      userAgreements.find((agreement) => {
        const from = new Date(agreement.valid_from).getTime();
        const to = agreement.valid_to ? new Date(`${agreement.valid_to}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
        const point = new Date(`${period.end_date}T23:59:59.999`).getTime();
        return Number.isFinite(from) && from <= point && point <= to;
      }) ??
      userAgreements[0] ??
      null;
    const override = getLatestHourlyOverride(overrides, user.id);
    const totalWorkMinutes = userSessions.reduce((sum, session) => sum + sessionWorkedMinutes(session), 0);

    let calculatedBaseSalary = 0;
    let calculatedSalaryType = currentAgreement?.salary_type ?? "hourly";

    if (currentAgreement?.salary_type === "monthly") {
      calculatedBaseSalary = toNumber(currentAgreement.monthly_salary);
      calculatedSalaryType = "monthly";
    } else {
      calculatedBaseSalary = userSessions.reduce(
        (sum, session) => sum + resolveSessionLaborCost(session, currentAgreement, override),
        0
      );
      calculatedSalaryType = "hourly";
    }

    const existingPayslip = existingPayslips.find((row) => row.user_id === user.id) ?? null;
    const manualAdjustments = toNumber(existingPayslip?.manual_adjustments);
    const itemTotal = existingPayslip ? getPayslipItemsTotal(payslipItems, existingPayslip.id) : 0;
    const grossSalary = Math.round((calculatedBaseSalary + manualAdjustments + itemTotal) * 100) / 100;

    if (existingPayslip) {
      const updateResult = await query(supabase.from("payslips"))
        .update({
          calculated_salary_type: calculatedSalaryType,
          total_work_minutes: totalWorkMinutes,
          calculated_base_salary: calculatedBaseSalary,
          gross_salary: grossSalary,
        })
        .eq("id", existingPayslip.id)
        .select(
          "id,payroll_period_id,user_id,calculated_salary_type,total_work_minutes,calculated_base_salary,manual_adjustments,gross_salary,notes"
        )
        .maybeSingle();

      if (updateResult.error) throw new Error(updateResult.error.message);
      if (updateResult.data) createdOrUpdated.push(updateResult.data as PayslipRow);
      continue;
    }

    const insertResult = await query(supabase.from("payslips"))
      .insert({
        payroll_period_id: period.id,
        user_id: user.id,
        calculated_salary_type: calculatedSalaryType,
        total_work_minutes: totalWorkMinutes,
        calculated_base_salary: calculatedBaseSalary,
        manual_adjustments: 0,
        gross_salary: grossSalary,
        notes: null,
      })
      .select(
        "id,payroll_period_id,user_id,calculated_salary_type,total_work_minutes,calculated_base_salary,manual_adjustments,gross_salary,notes"
      )
      .maybeSingle();

    if (insertResult.error) throw new Error(insertResult.error.message);
    if (insertResult.data) createdOrUpdated.push(insertResult.data as PayslipRow);
  }

  return { payslips: createdOrUpdated };
}

export async function regenerateEditablePayslipsForUsers(
  supabase: SupabaseLike,
  userIds: string[]
) {
  const safeUserIds = [...new Set(userIds.filter(Boolean))];
  if (safeUserIds.length === 0) return;

  const [periodsResult, usersResult] = await Promise.all([
    query(supabase.from("payroll_periods"))
      .select("id,period_month,start_date,end_date,status")
      .order("period_month", { ascending: false })
      .range(0, 119),
    query(supabase.from("users"))
      .select("id,full_name,email,phone,role,active,system_access")
      .in("id", safeUserIds)
      .range(0, 999),
  ]);

  if (periodsResult.error) throw new Error(periodsResult.error.message);
  if (usersResult.error) throw new Error(usersResult.error.message);

  const periods = ((periodsResult.data ?? []) as PayrollPeriodRow[]).filter((period) =>
    isPayrollPeriodEditable(period.status)
  );
  const users = (usersResult.data ?? []) as SalaryCenterUserRow[];

  for (const period of periods) {
    for (const userId of safeUserIds) {
      await generatePayslipsForPeriod(supabase, period, users, userId);
    }
  }
}

export async function recalculateUserSessionCostsFromRules(
  supabase: SupabaseLike,
  userId: string,
  options?: {
    fromDate?: string | null;
  }
) {
  const safeUserId = userId.trim();
  if (!safeUserId) return;

  const [periodsResult, sessionsResult, agreementsResult, overridesResult] = await Promise.all([
    query(supabase.from("payroll_periods"))
      .select("id,period_month,start_date,end_date,status")
      .order("period_month", { ascending: false })
      .range(0, 119),
    query(supabase.from("attendance_sessions"))
      .select(
        "id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id"
      )
      .eq("user_id", safeUserId)
      .order("clock_in", { ascending: false })
      .range(0, 4999),
    query(supabase.from("salary_agreements"))
      .select(
        "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours"
      )
      .eq("user_id", safeUserId)
      .order("valid_from", { ascending: false }),
    query(supabase.from("hourly_salary_overrides"))
      .select("id,user_id,override_hourly_rate,notes,created_at,updated_at")
      .eq("user_id", safeUserId)
      .order("created_at", { ascending: false })
      .range(0, 50),
  ]);

  if (periodsResult.error) throw new Error(periodsResult.error.message);
  if (sessionsResult.error) throw new Error(sessionsResult.error.message);
  if (agreementsResult.error) throw new Error(agreementsResult.error.message);
  if (overridesResult.error) throw new Error(overridesResult.error.message);

  const sessions = (sessionsResult.data ?? []) as WorkSessionRow[];
  const periods = (periodsResult.data ?? []) as PayrollPeriodRow[];
  const agreements = (agreementsResult.data ?? []) as SalaryAgreementRow[];
  const overrides = (overridesResult.data ?? []) as HourlySalaryOverrideRow[];
  const latestOverride = getLatestHourlyOverride(overrides, safeUserId);
  const lockedIds = collectLockedSessionIds(sessions, periods);
  const fromDate = options?.fromDate?.trim() ? new Date(`${options.fromDate!.trim()}T00:00:00`) : null;
  const fromTime = fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate.getTime() : null;
  const calculatedCosts = calculateSessionLaborCostsByDay(
    sessions.filter((session) => !lockedIds.has(session.id)),
    agreements,
    latestOverride
  );

  for (const session of sessions) {
    if (lockedIds.has(session.id) || !session.clock_out) continue;
    if (fromTime !== null) {
      const sessionTime = new Date(session.clock_in).getTime();
      if (!Number.isFinite(sessionTime) || sessionTime < fromTime) continue;
    }

    const nextLaborCost = calculatedCosts.get(session.id) ?? 0;
    if (Math.abs(toNumber(session.labor_cost) - nextLaborCost) < 0.005) continue;

    const updateResult = await query(supabase.from("attendance_sessions"))
      .update({ labor_cost: nextLaborCost })
      .eq("id", session.id)
      .select("id")
      .maybeSingle();

    if (updateResult.error) throw new Error(updateResult.error.message);
  }

  await regenerateEditablePayslipsForUsers(supabase, [safeUserId]);
}
