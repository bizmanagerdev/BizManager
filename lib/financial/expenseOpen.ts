import type { FinancialEntry } from "@/lib/financial/types";

// ── How much of an expense is still owed ────────────────────────────────────
// ONE rule, used by every screen that says "we still owe X" (the payments
// calendar, the חובות page, a project's "אנחנו חייבים", the open-liabilities
// total), so the same bill never shows two different balances:
//
//   paid      → 0 (nothing left)
//   partial   → amount − paid_amount (never below 0)
//   not_paid  → the whole amount
//   no status → 0. Rows with no status are legacy generator rows that the money
//               engine already treats as paid ("posted") once their date passes
//               (see buildExpenseFlowMeta) — counting them as debt here would
//               make this page disagree with the cash flow.

export type ExpenseOpenInput = {
  amount: number | string | null | undefined;
  paid_amount?: number | string | null;
  payment_status?: string | null;
};

function toAmount(value: number | string | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export type ExpensePaymentState = "paid" | "partial" | "not_paid" | null;

export function normalizeExpensePaymentState(status: string | null | undefined): ExpensePaymentState {
  const value = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (value === "paid" || value === "partial" || value === "not_paid") return value;
  return null;
}

/** What is still owed on this expense. */
export function expenseOpenAmount(input: ExpenseOpenInput): number {
  const state = normalizeExpensePaymentState(input.payment_status);
  const amount = Math.max(toAmount(input.amount), 0);
  if (state === "not_paid") return round2(amount);
  if (state === "partial") return round2(Math.max(amount - Math.max(toAmount(input.paid_amount), 0), 0));
  return 0;
}

/** What has already been paid on this expense (the other side of expenseOpenAmount). */
export function expensePaidSoFar(input: ExpenseOpenInput): number {
  const amount = Math.max(toAmount(input.amount), 0);
  return round2(Math.max(amount - expenseOpenAmount(input), 0));
}

/**
 * A ledger entry as it counts toward "still to pay": a partly-paid expense that
 * hasn't been settled carries only its unpaid part. Everything else is returned
 * unchanged — the engine's own amount is already what's owed for it.
 */
export function withOpenAmount(entry: FinancialEntry): FinancialEntry {
  if (entry.origin !== "expense" || entry.type !== "outflow" || entry.stage === "posted") return entry;
  if (normalizeExpensePaymentState(entry.paymentStatus) !== "partial") return entry;
  const open = expenseOpenAmount({
    amount: entry.amount,
    paid_amount: entry.expensePaidAmount ?? 0,
    payment_status: "partial",
  });
  if (open === entry.amount) return entry;
  return { ...entry, amount: open, signedAmount: -open };
}
