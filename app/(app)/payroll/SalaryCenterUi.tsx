import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { LoadingDots } from "@/components/ui/loading-dots";
import { StatusBadge } from "@/components/ui/status-badge";
import { getPaymentStatusLabel as getSharedPaymentStatusLabel } from "@/lib/ui/status-colors";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { getPayrollWorkerTypeLabel, type PayrollWorkerType } from "@/lib/payroll-worker-type";
import { formatDateTime, toNumber } from "@/lib/payroll";

// ════════════════════════════════════════════════════════════════════════════
// Presentational pieces + pure formatters extracted from SalaryCenterClient so
// the main file holds orchestration, not badges and label maps. No component
// state here — everything is props-only or a pure function.
// ════════════════════════════════════════════════════════════════════════════

export const PAYSLIP_ITEM_TYPES = [
  { value: "bonus", label: "בונוס" },
  { value: "overtime_extra", label: "תוספת שעות נוספות" },
  { value: "travel_allowance", label: "דמי נסיעה" },
  { value: "meal_allowance", label: "דמי אוכל" },
  { value: "advance", label: "מקדמה" },
  { value: "deduction", label: "ניכוי" },
  { value: "exception_absence", label: "היעדרות" },
  { value: "exception_partial_month", label: "חודש חלקי" },
  { value: "manual_adjustment", label: "התאמה ידנית" },
] as const;

// ── Pure formatters / label maps ────────────────────────────────────────────

export function getPayslipItemTypeLabel(value: string | null | undefined) {
  return PAYSLIP_ITEM_TYPES.find((t) => t.value === value)?.label ?? value ?? "פריט";
}

export function isExceptionItemType(value: string | null | undefined) {
  return value === "exception_absence" || value === "exception_partial_month";
}

export function paymentStatusLabel(status: string | null | undefined) {
  if (status === "paid") return "שולם";
  if (status === "partial") return "שולם חלקית";
  if (status === "overpaid") return "שולם יתר";
  if (status === "not_due") return "טרם הגיע מועד התשלום";
  if (status === "pending") return "ממתין לתשלום";
  return "לא שולם";
}

export function sharedPaymentStatusLabel(status: string | null | undefined) {
  if (status === "overpaid") return paymentStatusLabel(status);
  return getSharedPaymentStatusLabel(status ?? "unpaid");
}

export function formatWorkerPaymentMethodLabel(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return "";

  const lowered = normalized.toLowerCase();
  if (lowered === "cash") return "מזומן";
  if (lowered === "transfer" || lowered === "bank transfer" || lowered === "wire") return "העברה";
  if (lowered === "check" || lowered === "cheque") return "צ׳ק";
  if (lowered === "credit" || lowered === "credit card") return "אשראי";
  if (lowered === "bit") return "ביט";
  if (lowered === "paybox") return "פייבוקס";

  return normalized;
}

export function escapePrintHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function getRoleLabel(value: string | null | undefined) {
  if (value === "worker") return "עובד";
  if (value === "worker_no_access") return "עובד ללא גישה";
  if (value === "office") return "משרד";
  if (value === "admin") return "מנהל";
  return value || "-";
}

export function getBillingStatusLabel(value: string | null | undefined) {
  if (value === "paid") return "שולם";
  if (value === "billable") return "לחיוב";
  if (value === "not_billable") return "לא לחיוב";
  if (value === "pending") return "ממתין";
  return value || "-";
}

export function formatLocalDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getFullYear()).slice(-2)}`;
}

export function formatLocalTime(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatSessionRange(clockIn: string, clockOut: string | null) {
  const start = new Date(clockIn);
  const end = clockOut ? new Date(clockOut) : null;
  if (Number.isNaN(start.getTime())) return formatDateTime(clockIn);
  if (!end || Number.isNaN(end.getTime())) {
    return `${formatLocalDate(start)} • ${formatLocalTime(start)} - פתוח`;
  }

  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  if (sameDay) {
    return `${formatLocalDate(start)} • ${formatLocalTime(start)}-${formatLocalTime(end)}`;
  }

  return `${formatLocalDate(start)} ${formatLocalTime(start)} → ${formatLocalDate(end)} ${formatLocalTime(end)}`;
}

export function formatMonthYearLabel(year: string, month: string, includeYear = true) {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  if (!Number.isFinite(normalizedYear) || !Number.isFinite(normalizedMonth) || normalizedMonth < 1 || normalizedMonth > 12) {
    return includeYear ? `${month}/${year}` : month;
  }
  return new Intl.DateTimeFormat("he-IL", includeYear ? { month: "long", year: "numeric" } : { month: "long" }).format(
    new Date(normalizedYear, normalizedMonth - 1, 1)
  );
}

export function formatPrintPeriodLabel(year: string, month: string) {
  if (!month && !year) return "כל החודשים והשנים";
  if (year && !month) return `כל החודשים בשנת ${year}`;
  if (month && !year) return `${formatMonthYearLabel(String(new Date().getFullYear()), month, false)} בכל השנים`;
  return formatMonthYearLabel(year, month);
}

export function toDateTimeLocalValue(date: Date) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

// ── Presentational components ───────────────────────────────────────────────

export function WorkerTypeBadge({ workerType }: { workerType: PayrollWorkerType }) {
  // Worker descriptor badges are all blue (info) so they read as one group and never
  // get confused with the green/orange/red payment-status badge.
  return <StatusPill tone="info">{getPayrollWorkerTypeLabel(workerType)}</StatusPill>;
}

export function MiniStat({
  label,
  value,
  loading = false,
  strong = false,
}: {
  label: string;
  value: ReactNode;
  loading?: boolean;
  // Headline figures sitting in the same row as their breakdown read bigger.
  strong?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-2.5 text-center ${strong ? "bg-muted/30" : "bg-muted/10"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-semibold ${strong ? "text-lg" : ""}`}>{loading ? <LoadingDots /> : value}</div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-right text-sm">
      <div className="font-medium">{label}</div>
      {children}
    </label>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <Badge variant="outline">{children}</Badge>;
}

export function StatusPill({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "muted" | "success" | "warning" | "danger" | "info";
}) {
  const className = getStatusColorClasses(tone === "muted" ? "neutral" : tone);

  return <Badge className={className}>{children}</Badge>;
}

export function PaymentStatusBadge({
  status,
  owedAmount,
}: {
  status: string | null | undefined;
  owedAmount?: number | string | null;
}) {
  const owed = toNumber(owedAmount);
  // Negative balance = the worker was paid ahead (advance / overpayment) → credit, not "paid".
  if (owed < -0.009) {
    return <StatusBadge value="overpaid" type="payment" />;
  }
  if (owed <= 0.009) {
    return <StatusBadge value="paid" type="payment" />;
  }

  const normalized =
    status === "paid" ||
    status === "partial" ||
    status === "overpaid" ||
    status === "pending" ||
    status === "not_due"
      ? status
      : "unpaid";
  return <StatusBadge value={normalized} type="payment" />;
}

export function RoleBadge({ role }: { role: string | null | undefined }) {
  // All role badges (עובד / פועל / מנהל / משרד …) share the same blue (info) tone so
  // they group visually and don't clash with the payment-status colours.
  return <StatusPill tone="info">{getRoleLabel(role)}</StatusPill>;
}

export function AccessBadge({ hasAccess }: { hasAccess: boolean }) {
  return <StatusPill tone={hasAccess ? "success" : "muted"}>{hasAccess ? "עם גישה" : "ללא גישה"}</StatusPill>;
}
