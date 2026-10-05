import { describe, it, expect } from "vitest";
import {
  expenseOpenAmount,
  expensePaidSoFar,
  normalizeExpensePaymentState,
  withOpenAmount,
} from "@/lib/financial/expenseOpen";
import type { FinancialEntry } from "@/lib/financial/types";

// The ONE rule for "how much of this expense do we still owe". Every screen
// that says "we owe X" (calendar, חובות, a project's אנחנו חייבים, the open
// liabilities total) goes through it, so these cases are the contract.

describe("expenseOpenAmount", () => {
  it("a partly-paid bill is owed for what's left of it", () => {
    // The container invoice: ₪33,431 with ₪10,000 paid.
    expect(expenseOpenAmount({ amount: 33431, paid_amount: 10000, payment_status: "partial" })).toBe(23431);
  });

  it("an unpaid bill is owed in full, whatever paid_amount holds", () => {
    expect(expenseOpenAmount({ amount: 1627, paid_amount: 0, payment_status: "not_paid" })).toBe(1627);
    expect(expenseOpenAmount({ amount: "3000", paid_amount: null, payment_status: "not_paid" })).toBe(3000);
  });

  it("a paid bill owes nothing", () => {
    expect(expenseOpenAmount({ amount: 500, paid_amount: 500, payment_status: "paid" })).toBe(0);
  });

  it("no status counts as paid — the money engine posts those legacy rows", () => {
    expect(expenseOpenAmount({ amount: 500, payment_status: null })).toBe(0);
    expect(expenseOpenAmount({ amount: 500, payment_status: "" })).toBe(0);
  });

  it("never goes below zero (overpaid partial) and never owes a negative bill", () => {
    expect(expenseOpenAmount({ amount: 100, paid_amount: 150, payment_status: "partial" })).toBe(0);
    expect(expenseOpenAmount({ amount: -50, payment_status: "not_paid" })).toBe(0);
  });

  it("reads numeric strings and rounds to agorot", () => {
    expect(expenseOpenAmount({ amount: "1356.66", paid_amount: "0.33", payment_status: " PARTIAL " })).toBe(1356.33);
  });
});

describe("expensePaidSoFar", () => {
  it("is the other side of the open amount", () => {
    expect(expensePaidSoFar({ amount: 33431, paid_amount: 10000, payment_status: "partial" })).toBe(10000);
    expect(expensePaidSoFar({ amount: 400, payment_status: "not_paid" })).toBe(0);
    expect(expensePaidSoFar({ amount: 400, payment_status: "paid" })).toBe(400);
  });
});

describe("normalizeExpensePaymentState", () => {
  it("keeps the three known states and drops anything else", () => {
    expect(normalizeExpensePaymentState("paid")).toBe("paid");
    expect(normalizeExpensePaymentState("Partial")).toBe("partial");
    expect(normalizeExpensePaymentState("not_paid")).toBe("not_paid");
    expect(normalizeExpensePaymentState("pending")).toBeNull();
    expect(normalizeExpensePaymentState(undefined)).toBeNull();
  });
});

function entry(overrides: Partial<FinancialEntry> = {}): FinancialEntry {
  return {
    id: "expense:e1",
    type: "outflow",
    amount: 33431,
    signedAmount: -33431,
    businessDomain: "logistics_projects",
    domainName: "פרויקטים",
    flowDate: "2026-09-14",
    recordedDate: "2026-09-14",
    dueDate: null,
    stage: "pending",
    sourceKind: "project",
    sourceId: "p1",
    sourceLabel: "פרויקט",
    sourceHref: "/projects/p1",
    description: "חשבונית מכולה",
    origin: "expense",
    reference: null,
    paymentMethod: null,
    paymentMethodLabel: null,
    paymentStatus: "partial",
    recordedByName: null,
    customerId: null,
    searchText: "",
    expensePaidAmount: 10000,
    ...overrides,
  };
}

describe("withOpenAmount", () => {
  it("a pending partly-paid expense carries only what's left", () => {
    const open = withOpenAmount(entry());
    expect(open.amount).toBe(23431);
    expect(open.signedAmount).toBe(-23431);
  });

  it("leaves everything else exactly as the engine built it", () => {
    const unpaid = entry({ paymentStatus: "not_paid", expensePaidAmount: null });
    expect(withOpenAmount(unpaid)).toBe(unpaid);
    const posted = entry({ stage: "posted" });
    expect(withOpenAmount(posted)).toBe(posted);
    const loan = entry({ origin: "loan", paymentStatus: "not_paid" });
    expect(withOpenAmount(loan)).toBe(loan);
    const inflow = entry({ type: "inflow" });
    expect(withOpenAmount(inflow)).toBe(inflow);
  });

  it("a scheduled (future) partial is owed for its remainder too", () => {
    expect(withOpenAmount(entry({ stage: "scheduled" })).amount).toBe(23431);
  });
});
