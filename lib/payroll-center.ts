import { getBusinessDomainLabel, type ExpenseBusinessDomain } from "@/lib/expenses";
import {
  getPayTrackingModeForWorkerType,
  normalizePayrollWorkerType,
  type PayrollWorkerType,
} from "@/lib/payroll-worker-type";
import { getLatestAuditByRecordIds, resolveUserDisplayNamesForValues } from "@/lib/audit";
import { fetchAllPagedResult } from "@/lib/supabase/paginate";
import {
  PAYSLIP_ITEM_COLUMNS,
  PAYSLIP_ITEMS_TABLE,
  WORKER_ABSENCE_COLUMNS,
  WORKER_ABSENCES_TABLE,
  type WorkerAbsenceRow,
} from "@/lib/payroll-bonuses";
import {
  calculateSessionLaborCost,
  getActiveSalaryAgreementForDate,
  monthKeyFromDate,
  sessionWorkedMinutes,
  toNumber,
  WORK_SESSIONS_TABLE,
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
  payroll_worker_type: PayrollWorkerType | null;
  pay_tracking_mode: "session" | "payslip" | null;
  /** UI language ('he' | 'ar'); admin-set here, only meaningful for a worker. */
  locale: "he" | "ar";
  /** Per-worker toggle for deliveries access; admin-set here, meaningless for staff. */
  deliveries_access: boolean;
};

export type SalaryCenterProjectOption = {
  id: string;
  label: string;
};

export type SessionPublicRow = WorkSessionRow & {
  locked?: boolean;
};

export type SessionCostRow = {
  id: string;
  labor_cost: number | string | null;
};

export type HourlySalaryOverrideRow = {
  id: string;
  user_id: string;
  start_time: string | null;
  end_time: string | null;
  override_hourly_rate: number | string | null;
  reason: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type PayslipItemRow = {
  id: string;
  /** Null while the item is waiting for its month's payslip to be generated. */
  payslip_id: string | null;
  user_id?: string | null;
  item_type: string | null;
  amount: number | string | null;
  /** The day the item is for — a bonus is dated, a travel allowance need not be. */
  item_date?: string | null;
  notes: string | null;
};

export type SalaryCenterProtectedPayload = {
  agreements: SalaryAgreementRow[];
  periods: PayrollPeriodRow[];
  payslips: PayslipRow[];
  payslipItems: PayslipItemRow[];
  hourlyOverrides: HourlySalaryOverrideRow[];
  sessionCosts: SessionCostRow[];
  workerPayments: WorkerPaymentRow[];
  workerPaymentAllocations: WorkerPaymentAllocationRow[];
  workerDebtItems: WorkerDebtItemRow[];
  workerAbsences: WorkerAbsenceRow[];
  sessionEffectivePayments: SessionEffectivePaymentRow[];
  workerBalances: WorkerBalanceRow[];
  workerPaymentRecordedByNameById: Record<string, string>;
  sessionRecordedByNameById: Record<string, string>;
  summary: {
    totalLaborCostThisMonth: number;
    unpaidOrUnfinishedPayslips: number;
    totalWorkerOwed: number;
  };
};

export type WorkerPaymentRow = {
  id: string;
  user_id: string;
  payment_date: string;
  amount: number | string | null;
  payment_method: string | null;
  reference_number: string | null;
  notes: string | null;
  account_id: string | null;
  recorded_by: string | null;
  created_at: string | null;
};

/** The two things a payment can settle. See worker_debt_items_view. */
export type WorkerDebtSourceType = "session" | "payslip";

export type WorkerPaymentAllocationRow = {
  id: string;
  worker_payment_id: string;
  source_type: WorkerDebtSourceType;
  attendance_session_id: string | null;
  payslip_id: string | null;
  amount: number | string | null;
  created_at: string | null;
};

export type WorkerDebtItemRow = {
  source_type: WorkerDebtSourceType;
  source_id: string;
  user_id: string;
  project_id: string | null;
  payslip_id: string | null;
  payroll_period_id: string | null;
  source_date: string | null;
  due_date: string | null;
  period_month: string | null;
  worked_minutes: number | string | null;
  earned_amount: number | string | null;
  paid_amount: number | string | null;
  owed_amount: number | string | null;
  payment_status: string | null;
  last_payment_date: string | null;
};

// Per-session effective paid status from session_effective_payment_view (the single
// source that folds in "a paid payslip covers all that month's sessions").
export type SessionEffectivePaymentRow = {
  session_id: string;
  user_id: string;
  payment_status: string | null;
  paid_amount: number | string | null;
  owed_amount: number | string | null;
  last_payment_date: string | null;
  is_payslip_covered: boolean | null;
};

export type WorkerBalanceRow = {
  user_id: string;
  item_count: number | string | null;
  open_item_count: number | string | null;
  earned_amount: number | string | null;
  paid_amount: number | string | null;
  owed_amount: number | string | null;
  payment_status: string | null;
  last_payment_date: string | null;
};

export function isSalaryTrackedWorker(
  user: Pick<SalaryCenterUserRow, "role" | "payroll_worker_type" | "pay_tracking_mode">
) {
  const workerType = normalizePayrollWorkerType(user.payroll_worker_type, user.pay_tracking_mode);
  return getPayTrackingModeForWorkerType(workerType) === "payslip";
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
  is: (column: string, value: null) => QueryLike;
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

/**
 * "That column isn't there yet" — a pre-migration read of a column the code
 * already knows about.
 *
 * Message-based, NOT code-based: these queries run through fetchAllPagedResult,
 * which used to flatten the PostgREST error down to `{ message }` and drop the
 * `42703` code, so a code check silently never matched and the caller's fallback
 * never ran. It's also table-agnostic — an earlier version hardcoded
 * `worker_debt_items_view.`, which made it useless for any other table.
 */
function isMissingColumnError(error: unknown, columnName: string) {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error ? (error as { message?: unknown }).message : undefined;
  if (typeof message !== "string") return false;
  const lowered = message.toLowerCase();
  return lowered.includes(columnName.toLowerCase()) && lowered.includes("does not exist");
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
  return getBusinessDomainLabel(session.business_domain);
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
      const agreement = getActiveSalaryAgreementForDate(agreements, new Date(session.clock_in));
      const workedMinutes = sessionWorkedMinutes(session);
      if (!agreement || workedMinutes <= 0) {
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
    workerPayments: [],
    workerPaymentAllocations: [],
    workerDebtItems: [],
    workerAbsences: [],
    sessionEffectivePayments: [],
    workerBalances: [],
    workerPaymentRecordedByNameById: {},
    sessionRecordedByNameById: {},
    summary: {
      totalLaborCostThisMonth: 0,
      unpaidOrUnfinishedPayslips: 0,
      totalWorkerOwed: 0,
    },
  };

  if (safeUserIds.length === 0) return emptyPayload;

  const [
    agreementsResult,
    periodsResult,
    payslipsResult,
    overridesResult,
    sessionCostsResult,
    workerBalancesResult,
    workerPaymentsResult,
    workerDebtItemsInitialResult,
    sessionEffectivePaymentsResult,
    workerAbsencesResult,
  ] = await Promise.all([
    query(supabase.from("salary_agreements"))
      .select(
        "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours,due_day_of_next_month,business_domain,project_id,property_id,is_billable_to_customer,bill_to_customer_amount"
      )
      .in("user_id", safeUserIds)
      .order("valid_from", { ascending: false }),
    query(supabase.from("payroll_periods"))
      .select("id,period_month,start_date,end_date,status")
      .order("period_month", { ascending: false })
      .range(0, 119),
    fetchAllPagedResult((lo, hi) =>
      query(supabase.from("payslips"))
        .select(
          "id,payroll_period_id,user_id,calculated_salary_type,total_work_minutes,calculated_base_salary,manual_adjustments,gross_salary,notes"
        )
        .in("user_id", safeSalaryTrackedUserIds)
        .range(lo, hi)
    ),
    query(supabase.from("hourly_salary_overrides"))
      .select("id,user_id,start_time,end_time,override_hourly_rate,reason,notes,created_at,updated_at")
      .in("user_id", safeUserIds)
      .order("created_at", { ascending: false })
      .range(0, 999),
    fetchAllPagedResult((lo, hi) =>
      query(supabase.from("attendance_sessions"))
        .select("id,labor_cost,clock_in,user_id")
        .in("user_id", safeUserIds)
        .range(lo, hi)
    ),
    query(supabase.from("worker_balance_summary_view"))
      .select("user_id,item_count,open_item_count,earned_amount,paid_amount,owed_amount,payment_status,last_payment_date")
      .in("user_id", safeUserIds)
      .range(0, 1999),
    fetchAllPagedResult((lo, hi) =>
      query(supabase.from("worker_payments"))
        .select("id,user_id,payment_date,amount,payment_method,reference_number,notes,account_id,recorded_by,created_at")
        .in("user_id", safeUserIds)
        .order("payment_date", { ascending: false })
        .range(lo, hi)
    ),
    // These two views depend only on safeUserIds, so they run with the first batch instead
    // of after it. The debt view's missing-column fallback is handled below, post-await.
    fetchAllPagedResult((lo, hi) =>
      query(supabase.from("worker_debt_items_view"))
        .select(
          "source_type,source_id,user_id,project_id,payslip_id,payroll_period_id,source_date,due_date,period_month,worked_minutes,earned_amount,paid_amount,owed_amount,payment_status,last_payment_date"
        )
        .in("user_id", safeUserIds)
        .range(lo, hi)
    ),
    fetchAllPagedResult((lo, hi) =>
      query(supabase.from("session_effective_payment_view"))
        .select("session_id,user_id,payment_status,paid_amount,owed_amount,last_payment_date,is_payslip_covered")
        .in("user_id", safeUserIds)
        .range(lo, hi)
    ),
    // Days off. Tolerant below — before the migration runs the table doesn't
    // exist, and the rest of the salary centre still works.
    fetchAllPagedResult((lo, hi) =>
      query(supabase.from(WORKER_ABSENCES_TABLE))
        .select(WORKER_ABSENCE_COLUMNS)
        .in("user_id", safeUserIds)
        .order("absence_date", { ascending: false })
        .range(lo, hi)
    ),
  ]);

  let workerDebtItemsResult = workerDebtItemsInitialResult;
  if (workerDebtItemsResult.error && isMissingColumnError(workerDebtItemsResult.error, "due_date")) {
    workerDebtItemsResult = await fetchAllPagedResult((lo, hi) =>
      query(supabase.from("worker_debt_items_view"))
        .select(
          "source_type,source_id,user_id,project_id,payslip_id,payroll_period_id,source_date,period_month,worked_minutes,earned_amount,paid_amount,owed_amount,payment_status,last_payment_date"
        )
        .in("user_id", safeUserIds)
        .range(lo, hi)
    );
  }

  // Single source for per-session paid status (folds in payslip coverage). Tolerant:
  // until create_session_effective_payment_view.sql is deployed the view won't exist,
  // so on error we degrade to empty (sessions then fall back to their own status).
  const sessionEffectivePayments = sessionEffectivePaymentsResult.error
    ? []
    : ((sessionEffectivePaymentsResult.data ?? []) as SessionEffectivePaymentRow[]).filter((row) => row.session_id);

  // Same tolerance for the absence table: missing until the migration is applied,
  // and its absence must not take the whole payroll page down.
  const workerAbsences = workerAbsencesResult.error
    ? []
    : ((workerAbsencesResult.data ?? []) as WorkerAbsenceRow[]).filter((row) => row.id);

  if (agreementsResult.error) throw new Error(agreementsResult.error.message);
  if (periodsResult.error) throw new Error(periodsResult.error.message);
  if (payslipsResult.error) throw new Error(payslipsResult.error.message);
  if (overridesResult.error) throw new Error(overridesResult.error.message);
  if (sessionCostsResult.error) throw new Error(sessionCostsResult.error.message);
  if (workerBalancesResult.error) throw new Error(workerBalancesResult.error.message);
  if (workerDebtItemsResult.error) throw new Error(workerDebtItemsResult.error.message);
  if (workerPaymentsResult.error) throw new Error(workerPaymentsResult.error.message);

  const payslips = ((payslipsResult.data ?? []) as PayslipRow[]).filter((row) => row.id);
  const payslipIds = payslips.map((row) => row.id);
  const workerPayments = ((workerPaymentsResult.data ?? []) as WorkerPaymentRow[]).filter((row) => row.id);
  const workerPaymentIds = workerPayments.map((row) => row.id);
  // By USER, not by payslip: a bonus recorded mid-month has no payslip_id yet, and
  // the worker's card has to show it before that month is generated.
  let payslipItemsResult = await fetchAllPagedResult((lo, hi) =>
    query(supabase.from(PAYSLIP_ITEMS_TABLE))
      .select(PAYSLIP_ITEM_COLUMNS)
      .in("user_id", safeUserIds)
      .range(lo, hi)
  );
  // Pre-migration there is no user_id column — fall back to the payslip-scoped read,
  // which is what this always was.
  if (payslipItemsResult.error) {
    payslipItemsResult = payslipIds.length
      ? await fetchAllPagedResult((lo, hi) =>
          query(supabase.from(PAYSLIP_ITEMS_TABLE))
            .select("id,payslip_id,item_type,amount,notes")
            .in("payslip_id", payslipIds)
            .range(lo, hi)
        )
      : { data: [], error: null };
  }
  const workerPaymentAllocationsResult = workerPaymentIds.length
    ? await fetchAllPagedResult((lo, hi) =>
        query(supabase.from("worker_payment_allocations"))
          .select("id,worker_payment_id,source_type,attendance_session_id,payslip_id,amount,created_at")
          .in("worker_payment_id", workerPaymentIds)
          .range(lo, hi)
      )
    : { data: [], error: null };

  if (payslipItemsResult.error) throw new Error(payslipItemsResult.error.message);
  if (workerPaymentAllocationsResult.error) throw new Error(workerPaymentAllocationsResult.error.message);

  const periods = (periodsResult.data ?? []) as PayrollPeriodRow[];
  const currentPeriod = getCurrentPayrollPeriod(periods);
  const currentMonthKey = getCurrentMonthKey();
  const currentMonthDate = new Date(`${currentMonthKey}-01T12:00:00`);
  const agreements = (agreementsResult.data ?? []) as SalaryAgreementRow[];
  const monthlyAgreementUserIds = new Set<string>();
  const monthlyAgreementTotal = safeSalaryTrackedUserIds.reduce((sum, userId) => {
    const userAgreements = agreements.filter((agreement) => agreement.user_id === userId);
    const activeAgreement = getActiveSalaryAgreementForDate(userAgreements, currentMonthDate);
    if (!activeAgreement || activeAgreement.salary_type !== "monthly") return sum;
    monthlyAgreementUserIds.add(userId);
    return sum + toNumber(activeAgreement.monthly_salary);
  }, 0);
  const sessionLaborCostThisMonth = ((sessionCostsResult.data ?? []) as Array<SessionCostRow & { clock_in: string; user_id: string }>)
    .filter(
      (session) =>
        monthKeyFromDate(session.clock_in) === currentMonthKey &&
        !monthlyAgreementUserIds.has(session.user_id)
    )
    .reduce((sum, session) => sum + toNumber(session.labor_cost), 0);
  const totalLaborCostThisMonth = sessionLaborCostThisMonth + monthlyAgreementTotal;
  const workerBalances = ((workerBalancesResult.data ?? []) as WorkerBalanceRow[]).filter((row) => row.user_id);
  const totalWorkerOwed = workerBalances.reduce((sum, row) => sum + toNumber(row.owed_amount), 0);
  const auditSupabase = supabase as Parameters<typeof resolveUserDisplayNamesForValues>[0];
  const paymentRecordedByValues = Array.from(
    new Set(
      workerPayments
        .map((payment) => (typeof payment.recorded_by === "string" ? payment.recorded_by : null))
        .filter((value): value is string => Boolean(value))
    )
  );
  const [paymentRecordedByNames, workerPaymentCreateAudit, sessionCreateAudit] = await Promise.all([
    resolveUserDisplayNamesForValues(auditSupabase, paymentRecordedByValues),
    getLatestAuditByRecordIds(auditSupabase, {
      tableName: "worker_payments",
      recordIds: workerPaymentIds,
      actions: ["create"],
    }),
    getLatestAuditByRecordIds(auditSupabase, {
      tableName: WORK_SESSIONS_TABLE,
      recordIds: ((sessionCostsResult.data ?? []) as Array<{ id: string }>).map((row) => row.id).filter(Boolean),
      actions: ["create"],
    }),
  ]);

  const workerPaymentRecordedByNameById: Record<string, string> = {};
  workerPayments.forEach((payment) => {
    const recordedByValue = typeof payment.recorded_by === "string" ? payment.recorded_by : null;
    if (recordedByValue && paymentRecordedByNames[recordedByValue]) {
      workerPaymentRecordedByNameById[payment.id] = paymentRecordedByNames[recordedByValue];
      return;
    }
    const audit = workerPaymentCreateAudit.byRecordId[payment.id];
    if (audit?.actorName) {
      workerPaymentRecordedByNameById[payment.id] = audit.actorName;
    }
  });

  const sessionRecordedByNameById: Record<string, string> = {};
  Object.entries(sessionCreateAudit.byRecordId).forEach(([sessionId, audit]) => {
    if (audit.actorName) {
      sessionRecordedByNameById[sessionId] = audit.actorName;
    }
  });

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
    agreements,
    periods,
    payslips,
    payslipItems: (payslipItemsResult.data ?? []) as PayslipItemRow[],
    hourlyOverrides: (overridesResult.data ?? []) as HourlySalaryOverrideRow[],
    workerPayments,
    workerPaymentAllocations: (workerPaymentAllocationsResult.data ?? []) as WorkerPaymentAllocationRow[],
    workerDebtItems: ((workerDebtItemsResult.data ?? []) as WorkerDebtItemRow[]).filter(
      (row) => row.user_id && row.source_id
    ),
    workerAbsences,
    sessionEffectivePayments,
    workerBalances,
    workerPaymentRecordedByNameById,
    sessionRecordedByNameById,
    sessionCosts: ((sessionCostsResult.data ?? []) as Array<SessionCostRow & { user_id: string }>).map(
      (row) => ({
        id: row.id,
        labor_cost: row.labor_cost,
      })
    ),
    summary: {
      totalLaborCostThisMonth,
      unpaidOrUnfinishedPayslips,
      totalWorkerOwed,
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
        "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours,due_day_of_next_month,business_domain,project_id,property_id,is_billable_to_customer,bill_to_customer_amount"
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
      .select("id,user_id,start_time,end_time,override_hourly_rate,reason,notes,created_at,updated_at")
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

    // The payslip row has to exist before loose items can point at it — a bonus
    // recorded on the 3rd has no payslip yet by design. So: ensure the row, adopt
    // this month's loose items, and only then work out the gross.
    let payslipId = existingPayslip?.id ?? null;
    if (!payslipId) {
      const insertResult = await query(supabase.from("payslips"))
        .insert({
          payroll_period_id: period.id,
          user_id: user.id,
          calculated_salary_type: calculatedSalaryType,
          total_work_minutes: totalWorkMinutes,
          calculated_base_salary: calculatedBaseSalary,
          manual_adjustments: 0,
          // Provisional — rewritten below once the items are in.
          gross_salary: Math.round(calculatedBaseSalary * 100) / 100,
          notes: null,
        })
        .select("id")
        .maybeSingle();

      if (insertResult.error) throw new Error(insertResult.error.message);
      payslipId = (insertResult.data as { id: string } | null)?.id ?? null;
      if (!payslipId) continue;
    }

    const adopted = await attachLooseItemsToPayslip(supabase, user.id, payslipId, period);
    payslipItems.push(...adopted);

    const itemTotal = getPayslipItemsTotal(payslipItems, payslipId);
    const grossSalary = Math.round((calculatedBaseSalary + manualAdjustments + itemTotal) * 100) / 100;

    const updateResult = await query(supabase.from("payslips"))
      .update({
        calculated_salary_type: calculatedSalaryType,
        total_work_minutes: totalWorkMinutes,
        calculated_base_salary: calculatedBaseSalary,
        gross_salary: grossSalary,
      })
      .eq("id", payslipId)
      .select(
        "id,payroll_period_id,user_id,calculated_salary_type,total_work_minutes,calculated_base_salary,manual_adjustments,gross_salary,notes"
      )
      .maybeSingle();

    if (updateResult.error) throw new Error(updateResult.error.message);
    if (updateResult.data) createdOrUpdated.push(updateResult.data as PayslipRow);
  }

  return { payslips: createdOrUpdated };
}

/**
 * The payslip that should carry a bonus dated `bonusDate`, if there is one yet.
 *
 * Returns `{ payslipId }` when that month is already generated, `{}` when it isn't
 * (the row stays loose and `attachLooseItemsToPayslip` adopts it later), or
 * `{ error }` when the month is LOCKED — a locked period is never regenerated, so
 * a bonus filed into one would be money that changes no number anywhere.
 */
export async function resolveBonusPayslip(
  supabase: SupabaseLike,
  userId: string,
  bonusDate: string
): Promise<{ payslipId?: string; error?: string }> {
  const periodResult = await query(supabase.from("payroll_periods"))
    .select("id,period_month,status")
    .lte("start_date", bonusDate)
    .gte("end_date", bonusDate)
    .maybeSingle();

  if (periodResult.error || !periodResult.data) return {};

  const period = periodResult.data as unknown as { id: string; period_month: string; status: string | null };
  if (!isPayrollPeriodEditable(period.status)) {
    return { error: `תקופת השכר ${period.period_month} נעולה — לא ניתן להוסיף בונוס בתאריך הזה.` };
  }

  const payslipResult = await query(supabase.from("payslips"))
    .select("id")
    .eq("payroll_period_id", period.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (payslipResult.error || !payslipResult.data) return {};
  return { payslipId: (payslipResult.data as unknown as { id: string }).id };
}

/**
 * Roll this month's not-yet-attached רכיבי שכר (in practice: bonuses the worker
 * recorded during the month) into the payslip that now covers them.
 *
 * Matching is by `item_date` inside the period, so a bonus can only ever land in
 * the month it was earned in. Returns the rows it adopted so the caller can add
 * them to its in-memory list before totalling.
 *
 * Tolerant: pre-migration there is no `item_date` / `payslip_id is null` case at
 * all, and payslips must still generate.
 */
async function attachLooseItemsToPayslip(
  supabase: SupabaseLike,
  userId: string,
  payslipId: string,
  period: PayrollPeriodRow
): Promise<PayslipItemRow[]> {
  const result = await query(supabase.from(PAYSLIP_ITEMS_TABLE))
    .update({ payslip_id: payslipId })
    .eq("user_id", userId)
    .is("payslip_id", null)
    .gte("item_date", period.start_date)
    .lte("item_date", period.end_date)
    .select(PAYSLIP_ITEM_COLUMNS);

  if (result.error) return [];
  return (result.data ?? []) as PayslipItemRow[];
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
      .select("id,full_name,email,phone,role,active,system_access,payroll_worker_type,pay_tracking_mode")
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
    regeneratePayslips?: boolean;
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
        "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours,due_day_of_next_month,business_domain,project_id,property_id,is_billable_to_customer,bill_to_customer_amount"
      )
      .eq("user_id", safeUserId)
      .order("valid_from", { ascending: false }),
    query(supabase.from("hourly_salary_overrides"))
      .select("id,user_id,start_time,end_time,override_hourly_rate,reason,notes,created_at,updated_at")
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

    if (!calculatedCosts.has(session.id)) continue;
    const nextLaborCost = calculatedCosts.get(session.id) ?? 0;
    if (Math.abs(toNumber(session.labor_cost) - nextLaborCost) < 0.005) continue;

    const updateResult = await query(supabase.from("attendance_sessions"))
      .update({ labor_cost: nextLaborCost })
      .eq("id", session.id)
      .select("id")
      .maybeSingle();

    if (updateResult.error) throw new Error(updateResult.error.message);
  }

  if (options?.regeneratePayslips !== false) {
    await regenerateEditablePayslipsForUsers(supabase, [safeUserId]);
  }
}
