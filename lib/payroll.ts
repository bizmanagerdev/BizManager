import { formatShortDate, formatShortDateTime } from "@/lib/date";

export const WORK_SESSIONS_TABLE = "attendance_sessions";
export const PAYROLL_ADMIN_COOKIE = "payroll_admin_unlocked";

export type WorkSessionRow = {
  id: string;
  user_id: string;
  clock_in: string;
  clock_out: string | null;
  worked_minutes: number | string | null;
  notes: string | null;
  business_domain: string | null;
  project_id: string | null;
  property_id: string | null;
};

export type SalaryAgreementRow = {
  id: string;
  user_id: string;
  salary_type: string;
  hourly_rate: number | string | null;
  monthly_salary: number | string | null;
  valid_from: string;
  valid_to: string | null;
  notes: string | null;
  overtime_rate: number | string | null;
  standard_daily_hours: number | string | null;
};

export type PayrollPeriodRow = {
  id: string;
  period_month: string;
  start_date: string;
  end_date: string;
  status: string;
};

export type PayslipRow = {
  id: string;
  payroll_period_id: string;
  user_id: string;
  calculated_salary_type: string;
  total_work_minutes: number | string;
  calculated_base_salary: number | string;
  manual_adjustments: number | string;
  gross_salary: number | string;
  notes: string | null;
};

export type MonthlyHoursSummary = {
  key: string;
  label: string;
  totalMinutes: number;
  sessionCount: number;
  openSessionCount: number;
};

export function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function formatCurrency(value: number | string | null | undefined) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

export function formatMinutes(minutes: number | string | null | undefined) {
  const total = Math.max(0, Math.round(toNumber(minutes)));
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  return `${hours}:${String(remainder).padStart(2, "0")}`;
}

export function formatDate(value: string | null | undefined) {
  return formatShortDate(value);
}

export function formatDateTime(value: string | null | undefined) {
  return formatShortDateTime(value);
}

export function monthKeyFromDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function monthLabelFromKey(key: string) {
  const [yearText, monthText] = key.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return key;
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1)
  );
}

export function buildMonthlyHoursSummary(sessions: WorkSessionRow[]) {
  const byMonth = new Map<string, MonthlyHoursSummary>();

  sessions.forEach((session) => {
    const key = monthKeyFromDate(session.clock_in);
    if (!key) return;
    const existing = byMonth.get(key) ?? {
      key,
      label: monthLabelFromKey(key),
      totalMinutes: 0,
      sessionCount: 0,
      openSessionCount: 0,
    };

    existing.totalMinutes += sessionWorkedMinutes(session);
    existing.sessionCount += 1;
    if (!session.clock_out) existing.openSessionCount += 1;
    byMonth.set(key, existing);
  });

  return [...byMonth.values()].sort((a, b) => b.key.localeCompare(a.key));
}

export function sessionWorkedMinutes(session: WorkSessionRow) {
  const explicit = toNumber(session.worked_minutes);
  if (explicit > 0) return explicit;
  if (!session.clock_out) return 0;

  return minutesBetween(session.clock_in, session.clock_out);
}

export function minutesBetween(startValue: string | Date, endValue: string | Date) {
  const start = typeof startValue === "string" ? new Date(startValue).getTime() : startValue.getTime();
  const end = typeof endValue === "string" ? new Date(endValue).getTime() : endValue.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

export function addMinutes(value: string | Date, minutes: number) {
  const base = typeof value === "string" ? new Date(value) : new Date(value.getTime());
  if (Number.isNaN(base.getTime())) return null;
  base.setMinutes(base.getMinutes() + Math.round(minutes));
  return base;
}

export function getCurrentSalaryAgreement(agreements: SalaryAgreementRow[], referenceDate = new Date()) {
  const point = new Date(referenceDate);
  return (
    agreements.find((agreement) => {
      const from = new Date(agreement.valid_from);
      const to = agreement.valid_to ? new Date(agreement.valid_to) : null;
      if (Number.isNaN(from.getTime())) return false;
      if (from > point) return false;
      if (to && to < point) return false;
      return true;
    }) ?? agreements[0] ?? null
  );
}

export function getSalaryTypeLabel(value: string | null | undefined) {
  if (value === "hourly") return "שעתי";
  if (value === "monthly") return "גלובלי";
  return value || "-";
}

export function getPayrollStatusLabel(value: string | null | undefined) {
  if (!value) return "-";
  if (value === "draft") return "טיוטה";
  if (value === "approved") return "מאושר";
  if (value === "paid") return "שולם";
  if (value === "open") return "פתוח";
  if (value === "closed") return "סגור";
  return value;
}

export function getNextMonthDueText(periodEndDate: string | null | undefined) {
  if (!periodEndDate) return "-";
  const end = new Date(periodEndDate);
  if (Number.isNaN(end.getTime())) return "-";
  const due = new Date(end.getFullYear(), end.getMonth() + 1, 10);
  return formatShortDate(
    `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`
  );
}
