// Pure money-form logic for the dashboard quick actions: validation, request-body
// builders, and the worker-payment debt allocation. Extracted from the giant
// createIncome / createExpense / saveWorkerPayment handlers so the money contracts
// can be unit-tested and the component holds wiring, not rules. No React, no fetch.

import { toNumber } from "@/lib/payroll";
import { mapProjectTypeToExpenseDomain } from "@/lib/expenses";
import type { WorkerDebtItemRow } from "@/lib/payroll-center";
import { HEBREW } from "@/app/(app)/dashboard/DashboardActions.constants";

// ─── Worker payment: open-debt math + allocation ─────────────────────────────

export type WorkerAllocation = { source_type: "session" | "payslip"; source_id: string; amount: number };

/** Total still-owed across a worker's open debt items (negatives floored at 0). */
export function sumOpenOwed(items: WorkerDebtItemRow[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, toNumber(item.owed_amount)), 0);
}

/** This worker's still-open debt items, oldest first (so a partial payment clears
 *  the earliest debt first). */
export function sortOpenWorkerDebt(items: WorkerDebtItemRow[], userId: string): WorkerDebtItemRow[] {
  return items
    .filter((item) => item.user_id === userId && toNumber(item.owed_amount) > 0.009)
    .sort((a, b) => (a.due_date ?? a.source_date ?? "").localeCompare(b.due_date ?? b.source_date ?? ""));
}

/** Spread a payment across open debts oldest-first, never exceeding each item's
 *  owed amount. Any remainder stays unallocated (an advance). Amounts rounded to
 *  the agora; items receiving < 0.01 are dropped. */
export function buildWorkerPaymentAllocations(
  amount: number,
  debtItems: WorkerDebtItemRow[]
): WorkerAllocation[] {
  let remaining = amount;
  return debtItems
    .map((item) => {
      const owed = Math.max(0, toNumber(item.owed_amount));
      const applied = Math.min(owed, remaining);
      remaining -= applied;
      return applied > 0.009
        ? {
            source_type: item.source_type as "session" | "payslip",
            source_id: item.source_id ?? "",
            amount: Math.round(applied * 100) / 100,
          }
        : null;
    })
    .filter((allocation): allocation is WorkerAllocation => allocation !== null);
}

export function validateWorkerPaymentForm(input: {
  workerPaymentUserId: string;
  workerPaymentDate: string;
  workerPaymentAmount: string;
  accountsCount: number;
  workerPaymentAccountId: string;
}): string | null {
  if (!input.workerPaymentUserId) return "יש לבחור עובד.";
  if (!input.workerPaymentDate) return "יש לבחור תאריך תשלום.";
  const amount = Number(input.workerPaymentAmount);
  if (!Number.isFinite(amount) || amount <= 0) return "יש להזין סכום תשלום תקין.";
  if (input.accountsCount > 0 && !input.workerPaymentAccountId) return "יש לבחור חשבון לתנועה.";
  return null;
}

// ─── Income (תקבול) ──────────────────────────────────────────────────────────

export function validateIncomeForm(input: {
  incomeBusinessDomain: string;
  linkedProjectId: string;
  linkedPropertyId: string;
  incomeDate: string;
  incomeMethod: string;
  incomeDueDate: string;
  incomeAmount: string;
  accountsCount: number;
  incomeAccountId: string;
}): string | null {
  if (!input.incomeBusinessDomain) return "יש לבחור תחום.";
  if (input.incomeBusinessDomain === "logistics_projects" && !input.linkedProjectId) {
    return HEBREW.sessionInvalidProject;
  }
  if (input.incomeBusinessDomain === "property_management" && !input.linkedPropertyId) {
    return HEBREW.sessionInvalidProperty;
  }
  if (!input.incomeDate || !input.incomeMethod.trim()) return HEBREW.incomeRequired;
  if (input.incomeMethod === "check" && !input.incomeDueDate) {
    return `${HEBREW.incomeRequired} (${HEBREW.paymentDueDate})`;
  }
  const amount = Number(input.incomeAmount);
  if (!Number.isFinite(amount) || amount <= 0) return HEBREW.incomeInvalidAmount;
  if (input.accountsCount > 0 && !input.incomeAccountId) return "יש לבחור חשבון לתנועה.";
  return null;
}

/** Request body for POST /api/payments/create. For a project-domain income the
 *  business_domain is mapped from the project's type (matches the project page). */
export function buildIncomePayload(input: {
  incomeBusinessDomain: string;
  linkedProjectId: string;
  linkedOrderId: string;
  linkedPropertyId: string;
  projectType: string | null;
  amount: number;
  incomeDate: string;
  incomeDueDate: string;
  incomeRequiresSplit: boolean;
  incomeMethod: string;
  incomeAccountId: string;
  incomeReference: string;
  incomeCheckNumber: string;
  incomeNotes: string;
  incomeTagIds: string[];
}) {
  return {
    business_domain:
      input.incomeBusinessDomain === "logistics_projects"
        ? mapProjectTypeToExpenseDomain(input.projectType)
        : input.incomeBusinessDomain,
    project_id: input.linkedProjectId || null,
    order_id: input.linkedOrderId || null,
    property_id: input.linkedPropertyId || null,
    amount_total: input.amount,
    payment_date: input.incomeDate,
    due_date: input.incomeDueDate.trim() || null,
    requires_split: input.incomeRequiresSplit,
    payment_method: input.incomeMethod,
    account_id: input.incomeAccountId || null,
    reference_number: input.incomeReference.trim() || null,
    check_number:
      input.incomeMethod === "check" && input.incomeCheckNumber.trim() ? input.incomeCheckNumber.trim() : null,
    notes: input.incomeNotes.trim() || null,
    tag_ids: input.incomeBusinessDomain === "general_business" ? input.incomeTagIds : [],
  };
}

// ─── Regular (non-worker) expense ────────────────────────────────────────────

export function validateRegularExpense(input: {
  expenseDate: string;
  expenseAmount: string;
  expensePaymentStatus: "paid" | "partial" | "not_paid";
  expensePaymentMethod: string;
  accountsCount: number;
  expenseAccountId: string;
  isProjectExpense: boolean;
  expenseBilledToCustomer: boolean;
  expenseBillToCustomerAmount: string;
}): string | null {
  if (!input.expenseDate) return HEBREW.expenseRequired;
  const amount = Number(input.expenseAmount);
  if (!Number.isFinite(amount) || amount <= 0) return HEBREW.expenseInvalidAmount;

  const moneyMoving = input.expensePaymentStatus === "paid" || input.expensePaymentStatus === "partial";
  if (moneyMoving && !input.expensePaymentMethod) return "יש לבחור אמצעי תשלום.";
  if (moneyMoving && input.accountsCount > 0 && !input.expenseAccountId) return "יש לבחור חשבון לתנועה.";

  // Bill-to-customer (project domain only): when on, a positive amount is required.
  if (input.isProjectExpense && input.expenseBilledToCustomer) {
    const bill = input.expenseBillToCustomerAmount.trim() ? Number(input.expenseBillToCustomerAmount) : null;
    if (bill === null || !Number.isFinite(bill) || bill <= 0) return "יש להזין סכום לחיוב לקוח.";
  }
  return null;
}

/** Request body for POST /api/expenses/create (regular, non-worker expense). */
export function buildRegularExpensePayload(input: {
  expenseBusinessDomain: string;
  linkedProjectId: string;
  linkedOrderId: string;
  linkedPropertyId: string;
  expenseAmount: string;
  finalExpenseCategory: string;
  expenseDate: string;
  expenseDescription: string;
  expenseNotes: string;
  expenseBilledToCustomer: boolean;
  expenseBillToCustomerAmount: string;
  expensePaymentStatus: "paid" | "partial" | "not_paid";
  expensePaymentMethod: string;
  expenseAccountId: string;
  expenseCategory: string;
  carsCategory: string;
  expenseTagIds: string[];
}) {
  const isProjectExpense = input.expenseBusinessDomain === "logistics_projects";
  const regularBillToCustomerAmount =
    isProjectExpense && input.expenseBilledToCustomer && input.expenseBillToCustomerAmount.trim()
      ? Number(input.expenseBillToCustomerAmount)
      : null;
  return {
    business_domain: input.expenseBusinessDomain,
    project_id: input.linkedProjectId || null,
    order_id: input.linkedOrderId || null,
    property_id: input.linkedPropertyId || null,
    amount: Number(input.expenseAmount),
    category: input.finalExpenseCategory,
    expense_date: input.expenseDate,
    description: input.expenseDescription.trim() || null,
    notes: input.expenseNotes.trim() || null,
    included_in_base_price: isProjectExpense ? !input.expenseBilledToCustomer : false,
    billed_to_customer: isProjectExpense ? input.expenseBilledToCustomer : false,
    bill_to_customer_amount: regularBillToCustomerAmount,
    payment_status: input.expensePaymentStatus,
    payment_method:
      input.expensePaymentStatus === "paid" || input.expensePaymentStatus === "partial"
        ? input.expensePaymentMethod || null
        : null,
    account_id: input.expenseAccountId || null,
    tag_ids: input.expenseCategory === input.carsCategory ? input.expenseTagIds : [],
  };
}
