// A property's money as one table (owner, 2026-10-20: "like the projects and
// orders page"): every payment in, every expense and worker shift out, in the
// project page's own ledger (ProjectMovements). Income is one list, whatever
// it was paid with — rent by transfer or cash used to land under "הכנסות
// אחרות" and read as unpaid rent. What hasn't happened yet — a rent check
// not yet cleared, a bill not yet paid — is its own list below (note 3 on the
// card: "תשלומים צפויים צריכים לרדת למטה … ברשימה נפרדת").

import type { Movement } from "@/app/(app)/projects/[id]/ProjectMovements";
import { sessionLaborCost, sessionPaymentStatus } from "@/app/(app)/projects/[id]/ProjectTabsClient.helpers";
import type { FinancialAttachment } from "@/lib/payments";
import { formatMinutes, sessionWorkedMinutes, formatCurrency } from "@/lib/payroll";
import { normalizePayrollWorkerType, shouldShowSessionHours } from "@/lib/payroll-worker-type";
import { paymentMethodLabel } from "@/lib/orders/paymentStatus";
import { formatShortDate, formatShortDateTime } from "@/lib/date";
import type { LeaseAgreement, PropertyExpense, PropertyPayment, PropertySession } from "@/lib/properties";
import { dayKey, leaseForPayment, paymentPeriodLabel, type RentPayment } from "@/lib/property-rent";

export { dayKey };

export type PropertyMovementUser = {
  id: string;
  label: string;
  payrollWorkerType: string | null;
  payTrackingMode: string | null;
};

export type PropertyMovementInput = {
  payments: PropertyPayment[];
  /** The property's leases: each rent payment says the month(s) it's for by its lease's calendar. */
  leases?: LeaseAgreement[];
  currentLease?: LeaseAgreement | null;
  expenses: PropertyExpense[];
  sessions: PropertySession[];
  sessionAttachments: Record<string, FinancialAttachment[]>;
  accountNames: Record<string, string>;
  /** A generated expense reads by its template's name, as in the ledger and the calendar. */
  templateNameById: Map<string, string>;
  users: PropertyMovementUser[];
  onEditPayment: (payment: PropertyPayment) => void;
  onDeletePayment: (payment: PropertyPayment) => void;
  /** A rent check: נפרע / ביטול הסימון. */
  onToggleCleared: (payment: PropertyPayment) => void;
  onEditExpense: (expense: PropertyExpense) => void;
  onDeleteExpense: (expense: PropertyExpense) => void;
  onEditSession: (session: PropertySession) => void;
  onDeleteSession: (session: PropertySession) => void;
};


/** "נובמבר 2026" — the month a rent payment is for (the "weird date" it printed before). */
export function rentMonthLabel(value: string | null | undefined): string | null {
  const key = dayKey(value);
  if (!key) return null;
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1))
  );
}

/** A payment's rent fields, as lib/property-rent.ts reads them. */
export function toRentPayment(payment: PropertyPayment): RentPayment {
  return {
    date: payment.date,
    paymentStatus: payment.paymentStatus,
    amount: payment.amount,
    leaseId: payment.leaseId,
    periodStart: payment.rentPeriodStart,
    periods: payment.rentPeriods,
    countsAsRent: payment.countsAsRent,
  };
}

/**
 * A payment's title: what it was for, as written; otherwise a check from the
 * rent schedule, or a payment that says its month, by the month(s) it pays.
 */
export function paymentTitle(payment: PropertyPayment, periodLabel: string | null = null): string {
  const note = payment.notes?.trim().split("\n")[0]?.trim();
  if (note) return note;
  if (periodLabel && (payment.method === "check" || payment.rentPeriodStart)) return `שכירות ${periodLabel}`;
  if (payment.method === "check") {
    const month = rentMonthLabel(payment.date);
    return month ? `שכירות ${month}` : "שכירות";
  }
  return "הכנסה";
}

/** Not in yet: a check that hasn't cleared. */
export function isExpectedPayment(payment: PropertyPayment): boolean {
  return payment.paymentStatus === "pending";
}

/** Not paid yet, or only partly. */
export function isExpectedExpense(expense: PropertyExpense): boolean {
  return (expense.paymentStatus ?? "not_paid") !== "paid";
}

function methodHint(payment: PropertyPayment): string | null {
  if (payment.method === "check") return payment.checkNumber ? `צ׳ק #${payment.checkNumber}` : "צ׳ק";
  const label = paymentMethodLabel(payment.method);
  return label && label !== "-" ? label : null;
}

export function buildPropertyMovements(input: PropertyMovementInput): { done: Movement[]; expected: Movement[] } {
  const done: Movement[] = [];
  const expected: Movement[] = [];
  const accountName = (id: string | null) => (id ? input.accountNames[id] ?? null : null);
  const userById = new Map(input.users.map((u) => [u.id, u]));

  for (const payment of input.payments) {
    const rent = toRentPayment(payment);
    const lease = leaseForPayment(input.leases ?? [], rent, input.currentLease ?? null);
    const period = paymentPeriodLabel(lease, rent);
    const title = paymentTitle(payment, period);
    const extras: { label: string; value: string }[] = [];
    const method = paymentMethodLabel(payment.method);
    if (method && method !== "-") extras.push({ label: "אמצעי", value: method });
    if (payment.countsAsRent === false) extras.push({ label: "סוג", value: "לא שכירות" });
    else if (period) extras.push({ label: (payment.rentPeriods ?? 1) > 1 ? "לחודשים" : "לחודש", value: period });
    else if (payment.method === "check") {
      const month = rentMonthLabel(payment.date);
      if (month) extras.push({ label: "לחודש", value: month });
    }
    if (payment.method === "check") {
      if (payment.checkNumber) extras.push({ label: "מס' צ'ק", value: payment.checkNumber });
      if (payment.dueDate) extras.push({ label: "פירעון", value: formatShortDate(payment.dueDate, "—") });
    }
    if (payment.referenceNumber) extras.push({ label: "אסמכתא", value: payment.referenceNumber });
    const note = payment.notes?.trim();
    if (note && note !== title) extras.push({ label: "הערות", value: note });
    if (payment.createdAt) extras.push({ label: "נרשם", value: formatShortDateTime(payment.createdAt) });

    const pending = isExpectedPayment(payment);
    const isCheck = payment.method === "check";
    const row: Movement = {
      key: `payment:${payment.id}`,
      direction: "in",
      // A check moves money on its due date; its payment date is the month it's for.
      date: (isCheck ? payment.dueDate : null) ?? dayKey(payment.date),
      category: null,
      name: title,
      status: payment.paymentStatus,
      dueDate: payment.dueDate,
      billed: false,
      billedAmount: null,
      amount: payment.amount,
      account: accountName(payment.accountId),
      hint: methodHint(payment),
      extras,
      attachments: payment.attachments,
      fileLabel: isCheck ? "צילום הצ׳ק" : undefined,
      actions: isCheck
        ? [{ key: "cleared", label: pending ? "נפרע" : "ביטול הסימון", onSelect: () => input.onToggleCleared(payment) }]
        : undefined,
      onEdit: () => input.onEditPayment(payment),
      onDelete: () => input.onDeletePayment(payment),
    };
    (pending ? expected : done).push(row);
  }

  for (const expense of input.expenses) {
    const extras: { label: string; value: string }[] = [];
    const method = paymentMethodLabel(expense.paymentMethod);
    if (method && method !== "-") extras.push({ label: "אמצעי", value: method });
    if (expense.paymentStatus === "partial" && expense.paidAmount) {
      extras.push({ label: "שולם", value: formatCurrency(expense.paidAmount) });
    }
    const name =
      (expense.recurringTemplateId && input.templateNameById.get(expense.recurringTemplateId)) ||
      expense.description ||
      expense.category ||
      "הוצאה";
    const row: Movement = {
      key: `expense:${expense.id}`,
      direction: "out",
      date: dayKey(expense.date),
      category: expense.category,
      name,
      status: expense.paymentStatus ?? "not_paid",
      billed: false,
      billedAmount: null,
      amount: expense.amount,
      account: accountName(expense.accountId),
      hint: expense.notes?.trim() || null,
      extras,
      attachments: expense.attachments,
      onEdit: () => input.onEditExpense(expense),
      onDelete: () => input.onDeleteExpense(expense),
    };
    (isExpectedExpense(expense) ? expected : done).push(row);
  }

  for (const session of input.sessions) {
    const worker = userById.get(session.user_id);
    const showHours = shouldShowSessionHours(
      normalizePayrollWorkerType(worker?.payrollWorkerType ?? null, worker?.payTrackingMode ?? null)
    );
    const extras: { label: string; value: string }[] = [];
    if (showHours) {
      extras.push({ label: "כניסה", value: formatShortDateTime(session.clock_in) });
      if (session.clock_out) extras.push({ label: "יציאה", value: formatShortDateTime(session.clock_out) });
      extras.push({ label: "משך", value: formatMinutes(sessionWorkedMinutes(session)) });
    }
    done.push({
      key: `session:${session.id}`,
      direction: "out",
      date: session.clock_in,
      dateHasTime: showHours,
      category: "שכר עובד",
      name: worker?.label ?? "עובד",
      status: sessionPaymentStatus(session),
      dueDate: session.due_date ?? null,
      billed: false,
      billedAmount: null,
      amount: sessionLaborCost(session),
      employeeId: session.user_id,
      employeeName: worker?.label ?? null,
      account: null,
      hint: session.notes_he?.trim() || session.notes?.trim() || null,
      extras,
      attachments: input.sessionAttachments[session.id] ?? [],
      onEdit: () => input.onEditSession(session),
      onDelete: () => input.onDeleteSession(session),
    });
  }

  // Oldest first, like the project's: a statement is read down the months.
  // A tie keeps one order everywhere (the key).
  const byDate = (a: Movement, b: Movement) =>
    (a.date ?? "").localeCompare(b.date ?? "") || a.key.localeCompare(b.key);
  return { done: done.sort(byDate), expected: expected.sort(byDate) };
}
