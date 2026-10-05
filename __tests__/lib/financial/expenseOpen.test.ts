import { describe, it, expect } from "vitest";
import {
  expenseOpenAmount,
  expensePaidSoFar,
  normalizeExpensePaymentState,
  openLiabilityEntries,
  withOpenAmount,
} from "@/lib/financial/expenseOpen";
import { buildLoanEntries } from "@/lib/financial/entries";
import type { FinancialEntry } from "@/lib/financial/types";
import { deriveLoan, summarizeLoans } from "@/lib/loans";

// The ONE rule for "how much of this expense do we still owe". Every screen
// that says "we owe X" (calendar, חובות, a project's הוצאות שלא שולמו, the open
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

describe("openLiabilityEntries — the balance sheet's open bills", () => {
  it("bills already due and unpaid, each for what's left — not future bills, not money coming in", () => {
    const open = openLiabilityEntries([
      entry(),
      entry({ id: "expense:e2", amount: 1627, signedAmount: -1627, paymentStatus: "not_paid", expensePaidAmount: null }),
      entry({ id: "expense:e3", stage: "scheduled" }),
      entry({ id: "expense:e4", stage: "posted", paymentStatus: "paid" }),
      entry({ id: "payment:x", type: "inflow", origin: "payment", stage: "pending" }),
    ]);
    expect(open.map((e) => [e.id, e.amount])).toEqual([
      ["expense:e1", 23431],
      ["expense:e2", 1627],
    ]);
  });

  it("a late loan installment counts once in net worth — inside the loan's balance, not again as an open bill", () => {
    // ברנדווין: ₪200,000 taken, a ₪157,200 installment planned for September, still unpaid.
    const loan = deriveLoan(
      { id: "B", direction: "taken", amount: 200000, lender: "ברנדווין", loan_date: "2026-01-01" },
      [
        {
          id: "p1",
          loan_id: "B",
          repayment_date: "2026-09-01",
          amount: 157200,
          interest_amount: 0,
          method: null,
          account_id: null,
          notes: null,
          created_at: null,
          status: "planned",
          installment_index: 1,
          installment_count: 1,
        },
      ]
    );
    // A loan whose due date passed with no plan at all is the same case.
    const dueLoan = deriveLoan(
      { id: "R", direction: "taken", amount: 5000, lender: "רוזנפלד", loan_date: "2026-01-01", due_date: "2026-08-01" },
      []
    );
    const ledger = [...buildLoanEntries([loan, dueLoan], "2026-10-05"), entry()];
    // Both late loan amounts are on the ledger (the calendar shows them as late)…
    expect(ledger.filter((e) => e.origin === "loan" && e.stage === "pending").map((e) => e.amount)).toEqual([157200, 5000]);

    // …but the open bills are only the real bill, and the loans are counted once, in full.
    const openBills = openLiabilityEntries(ledger).reduce((sum, e) => sum + e.amount, 0);
    const borrowed = summarizeLoans([loan, dueLoan]).borrowedOutstanding;
    expect(openBills).toBe(23431);
    expect(borrowed).toBe(205000);
    expect(openBills + borrowed).toBe(228431); // was 390,631 — the ₪162,200 counted twice
  });
});
