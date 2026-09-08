import { describe, it, expect } from "vitest";
import {
  deriveLoan,
  overdueInstallments,
  buildInstallmentSchedule,
  summarizeLoans,
  loanStatusLabel,
  loanDirectionLabel,
  type Loan,
  type LoanRepayment,
} from "@/lib/loans";

function repayment(overrides: Partial<LoanRepayment>): LoanRepayment {
  return {
    id: "repay-1",
    loan_id: "loan-1",
    repayment_date: "2026-02-01",
    amount: 1000,
    interest_amount: 0,
    method: null,
    account_id: null,
    notes: null,
    created_at: null,
    status: "paid",
    installment_index: null,
    installment_count: null,
    ...overrides,
  };
}

describe("deriveLoan", () => {
  it("with no repayments: full amount outstanding, status active", () => {
    const loan = deriveLoan({ id: "loan-1", amount: 10000, direction: "given" }, []);
    expect(loan.outstanding).toBe(10000);
    expect(loan.repaidPrincipal).toBe(0);
    expect(loan.derivedStatus).toBe("active");
  });

  it("splits a repayment into principal vs interest — only principal reduces outstanding", () => {
    const loan = deriveLoan(
      { id: "loan-1", amount: 10000 },
      [repayment({ amount: 1100, interest_amount: 100 })]
    );
    expect(loan.repaidPrincipal).toBe(1000);
    expect(loan.repaidInterest).toBe(100);
    expect(loan.repaidTotal).toBe(1100);
    expect(loan.outstanding).toBe(9000);
    expect(loan.derivedStatus).toBe("partially_repaid");
  });

  it("derives 'repaid' once outstanding reaches ~0 (rounding-tolerant)", () => {
    const loan = deriveLoan({ id: "loan-1", amount: 1000 }, [repayment({ amount: 1000.005 })]);
    expect(loan.outstanding).toBe(0);
    expect(loan.derivedStatus).toBe("repaid");
  });

  it("a stored 'written_off' status always wins, regardless of outstanding", () => {
    const loan = deriveLoan({ id: "loan-1", amount: 10000, status: "written_off" }, []);
    expect(loan.derivedStatus).toBe("written_off");
  });

  it("a PLANNED installment does not reduce outstanding (it's a forecast, not cash moved)", () => {
    const loan = deriveLoan(
      { id: "loan-1", amount: 10000 },
      [repayment({ amount: 2000, status: "planned" })]
    );
    expect(loan.outstanding).toBe(10000);
    expect(loan.derivedStatus).toBe("active");
    expect(loan.plannedInstallments).toHaveLength(1);
    expect(loan.paidRepayments).toHaveLength(0);
  });

  it("scheduledPrincipal/unscheduledPrincipal split the outstanding between planned and unplanned", () => {
    const loan = deriveLoan(
      { id: "loan-1", amount: 10000 },
      [
        repayment({ id: "p1", amount: 3000, status: "planned", repayment_date: "2026-03-01" }),
        repayment({ id: "p2", amount: 2000, status: "planned", repayment_date: "2026-02-01" }),
      ]
    );
    expect(loan.scheduledPrincipal).toBe(5000);
    expect(loan.unscheduledPrincipal).toBe(5000); // 10000 outstanding - 5000 scheduled
    // nextInstallment is the EARLIEST due date, not insertion order.
    expect(loan.nextInstallment?.id).toBe("p2");
  });

  it("defaults direction to 'taken' and status to 'active' when unset", () => {
    const loan = deriveLoan({ id: "loan-1", amount: 100 }, []);
    expect(loan.direction).toBe("taken");
    expect(loan.status).toBe("active");
  });
});

describe("overdueInstallments", () => {
  it("returns only planned installments whose due date has already passed", () => {
    const loan = deriveLoan(
      { id: "loan-1", amount: 10000 },
      [
        repayment({ id: "past", amount: 1000, status: "planned", repayment_date: "2026-01-01" }),
        repayment({ id: "future", amount: 1000, status: "planned", repayment_date: "2026-12-01" }),
      ]
    );
    const overdue = overdueInstallments(loan, "2026-06-01");
    expect(overdue.map((r) => r.id)).toEqual(["past"]);
  });
});

describe("buildInstallmentSchedule", () => {
  it("splits the total evenly across N monthly installments", () => {
    const rows = buildInstallmentSchedule({ total: 3000, count: 3, firstDate: "2026-01-01" });
    expect(rows).toEqual([
      { date: "2026-01-01", amount: 1000 },
      { date: "2026-02-01", amount: 1000 },
      { date: "2026-03-01", amount: 1000 },
    ]);
  });

  it("puts rounding drift on the LAST installment so the plan sums to the total exactly", () => {
    const rows = buildInstallmentSchedule({ total: 1000, count: 3, firstDate: "2026-01-01" });
    // 1000 / 3 = 333.33... each -> 333.33, 333.33, then the remainder.
    expect(rows[0].amount).toBe(333.33);
    expect(rows[1].amount).toBe(333.33);
    expect(rows[2].amount).toBe(333.34);
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(1000);
  });

  it("supports a day-based interval instead of monthly", () => {
    const rows = buildInstallmentSchedule({
      total: 200,
      count: 2,
      firstDate: "2026-01-01",
      intervalDays: 14,
    });
    expect(rows.map((r) => r.date)).toEqual(["2026-01-01", "2026-01-15"]);
  });

  it("clamps a monthly step into a shorter month", () => {
    const rows = buildInstallmentSchedule({ total: 200, count: 2, firstDate: "2026-01-31" });
    expect(rows[1].date).toBe("2026-02-28");
  });

  it("returns [] for a non-positive total or a missing first date", () => {
    expect(buildInstallmentSchedule({ total: 0, count: 3, firstDate: "2026-01-01" })).toEqual([]);
    expect(buildInstallmentSchedule({ total: 1000, count: 3, firstDate: "" })).toEqual([]);
  });

  it("treats a non-positive count as 1", () => {
    const rows = buildInstallmentSchedule({ total: 500, count: 0, firstDate: "2026-01-01" });
    expect(rows).toEqual([{ date: "2026-01-01", amount: 500 }]);
  });
});

function loan(overrides: Partial<Loan>): Loan {
  return {
    id: "loan-1",
    direction: "taken",
    lender: null,
    borrower: null,
    loan_date: "2026-01-01",
    loan_method: null,
    repayment_method: null,
    account_id: null,
    documentation: null,
    amount: 1000,
    due_date: null,
    interest_amount: 0,
    business_domain: "general_business",
    counterparty_customer_id: null,
    counterparty_phone: null,
    status: "active",
    notes: null,
    created_at: null,
    repayments: [],
    paidRepayments: [],
    plannedInstallments: [],
    repaidPrincipal: 0,
    repaidInterest: 0,
    repaidTotal: 0,
    outstanding: 1000,
    scheduledPrincipal: 0,
    scheduledTotal: 0,
    unscheduledPrincipal: 1000,
    nextInstallment: null,
    derivedStatus: "active",
    ...overrides,
  };
}

describe("summarizeLoans", () => {
  it("splits taken vs given into borrowed (liability) vs lent (asset)", () => {
    const summary = summarizeLoans([
      loan({ id: "a", direction: "taken", outstanding: 1000, derivedStatus: "active" }),
      loan({ id: "b", direction: "given", outstanding: 500, derivedStatus: "active" }),
    ]);
    expect(summary.borrowedOutstanding).toBe(1000);
    expect(summary.lentOutstanding).toBe(500);
    expect(summary.netPosition).toBe(-500); // 500 asset - 1000 liability
    expect(summary.borrowedActiveCount).toBe(1);
    expect(summary.lentActiveCount).toBe(1);
  });

  it("a written-off loan is counted (for the total) but contributes 0 outstanding", () => {
    const summary = summarizeLoans([
      loan({ id: "a", direction: "taken", outstanding: 5000, derivedStatus: "written_off" }),
    ]);
    expect(summary.borrowedCount).toBe(1);
    expect(summary.borrowedOutstanding).toBe(0);
    expect(summary.borrowedActiveCount).toBe(0); // not "open" once written off
  });

  it("a fully repaid loan (outstanding ~0) doesn't count as active", () => {
    const summary = summarizeLoans([loan({ id: "a", outstanding: 0, derivedStatus: "repaid" })]);
    expect(summary.borrowedCount).toBe(1);
    expect(summary.borrowedActiveCount).toBe(0);
  });
});

describe("label helpers", () => {
  it("loanStatusLabel covers every status, defaulting to active", () => {
    expect(loanStatusLabel("repaid")).toBe("נפרע");
    expect(loanStatusLabel("partially_repaid")).toBe("נפרע חלקית");
    expect(loanStatusLabel("written_off")).toBe("נמחק");
    expect(loanStatusLabel("active")).toBe("פעיל");
  });
  it("loanDirectionLabel distinguishes taken vs given", () => {
    expect(loanDirectionLabel("taken")).toBe("הלוואה שלקחתי");
    expect(loanDirectionLabel("given")).toBe("הלוואה שנתתי");
  });
});
