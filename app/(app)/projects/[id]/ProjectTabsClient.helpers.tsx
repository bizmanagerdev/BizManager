import type { ReactNode } from "react";
import type { AuditRecordInfo } from "@/lib/audit";
import { formatShortDate, formatShortDateTime } from "@/lib/date";
import { paymentStatusClasses, paymentStatusLabel } from "@/lib/orders/paymentStatus";
import type { WorkSessionRow } from "@/lib/payroll";
import type { FinancialAttachment, PaymentRow } from "@/lib/payments";
import type { ExpenseListItem } from "./ProjectTabsClient";

// Pure formatting/getter/status helpers + the LtrInline span, lifted out of
// ProjectTabsClient so the component file holds state + orchestration only.
// Nothing here reads component state — every input arrives as an argument.

export type CustomerPaymentStatus = "paid" | "partial" | "unpaid" | "unpriced";

export function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function formatIls(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(value: string | null) {
  return formatShortDate(value, "—");
}

export function formatDateTime(value: string | null) {
  return formatShortDateTime(value, "—");
}

export function formatTimeOnly(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function isSameDay(a: string | null, b: string | null) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function LtrInline({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      dir="ltr"
      className={["inline-block text-left tabular-nums", className].filter(Boolean).join(" ")}
    >
      {children}
    </span>
  );
}

export function paymentRecordedByLabel(payment: PaymentRow, {
  paymentRecordedByNameByValue,
  paymentAuditById,
}: {
  paymentRecordedByNameByValue: Record<string, string>;
  paymentAuditById: Record<string, AuditRecordInfo>;
}) {
  const recordedByValue = typeof payment.recorded_by === "string" ? payment.recorded_by : null;
  if (recordedByValue && paymentRecordedByNameByValue[recordedByValue]) {
    return `הוזן ע״י ${paymentRecordedByNameByValue[recordedByValue]}`;
  }

  const audit = paymentAuditById[payment.id];
  if (audit?.action === "create") {
    return `הוזן ע״י ${audit.actorName}`;
  }

  return null;
}

export function expenseRecordedByLabel(item: ExpenseListItem, {
  expenseRecordedByNameByValue,
  expenseAuditById,
}: {
  expenseRecordedByNameByValue: Record<string, string>;
  expenseAuditById: Record<string, AuditRecordInfo>;
}) {
  if (item.source_type !== "expense") return null;

  const expenseId = getString(item.expense, "id");
  const recordedByValue = getString(item.expense, "recorded_by");

  if (recordedByValue && expenseRecordedByNameByValue[recordedByValue]) {
    return `הוזן ע״י ${expenseRecordedByNameByValue[recordedByValue]}`;
  }

  if (expenseId) {
    const audit = expenseAuditById[expenseId];
    if (audit?.action === "create") {
      return `הוזן ע״י ${audit.actorName}`;
    }
  }

  return null;
}

export function deriveCustomerPaymentStatus(totalDue: number | null, paidTotal: number): CustomerPaymentStatus {
  if (totalDue === null || totalDue <= 0) return "unpriced";
  if (paidTotal + 0.009 >= totalDue) return "paid";
  if (paidTotal > 0) return "partial";
  return "unpaid";
}

export function customerPaymentStatusLabel(status: CustomerPaymentStatus) {
  if (status === "unpriced") return "לא סוכם תשלום";
  return paymentStatusLabel(status);
}

export function customerPaymentStatusBadgeClasses(status: CustomerPaymentStatus) {
  if (status === "unpriced") return "border-border bg-background text-muted-foreground";
  return paymentStatusClasses(status);
}

export function sessionPaymentStatus(session: WorkSessionRow | null | undefined) {
  const explicitStatus = typeof session?.payment_status === "string" ? session.payment_status : "";
  if (explicitStatus) return explicitStatus;

  const paidAmount = Math.max(0, toNumber(session?.paid_amount) ?? 0);
  const laborCost = Math.max(0, toNumber(session?.labor_cost) ?? 0);
  if (!(paidAmount > 0)) return "unpaid";
  if (laborCost > 0 && paidAmount + 0.009 < laborCost) return "partial";
  return "paid";
}

export function getString(row: Record<string, unknown> | null, key: string) {
  if (!row) return null;
  const value = row[key];
  return typeof value === "string" ? value : null;
}

export function getFirstString(row: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = getString(row, key);
    if (value) return value;
  }
  return null;
}

export function getFirstDate(row: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = getString(row, key);
    if (value) return value;
  }
  return null;
}

export function sessionLaborCost(session: WorkSessionRow | null | undefined) {
  return Math.max(0, toNumber(session?.labor_cost) ?? 0);
}

export function isSessionBillable(session: WorkSessionRow | null | undefined) {
  return session?.is_billable_to_customer === true;
}

export function sessionBillToCustomerAmount(session: WorkSessionRow | null | undefined) {
  if (!isSessionBillable(session)) return 0;
  return Math.max(0, toNumber(session?.bill_to_customer_amount) ?? 0);
}

export function isImageAttachment(attachment: Pick<FinancialAttachment, "file_name" | "document_type">) {
  const name = attachment.file_name?.toLowerCase() ?? "";
  return /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)$/i.test(name) || attachment.document_type?.includes("photo");
}
