import { describe, it, expect } from "vitest";
import { buildLoanEntries, aggregateProfitLoss } from "@/lib/financial/entries";
import { buildInstallmentSchedule, deriveLoan, overdueInstallments, summarizeLoans } from "@/lib/loans";
import type { Loan, LoanRepayment } from "@/lib/loans";

// Loans split into a CASH movement (principal, origin "loan", excluded from P&L)
// and a P&L movement (interest, origin expense/payment). These tests lock that
// split — getting it wrong would double-count borrowed money as profit.

let seq = 0;
function makeRepayment(overrides: Partial<LoanRepayment> = {}): LoanRepayment {
  seq += 1;
  return {
    id: `r${seq}`,
    loan_id: "L1",
    repayment_date: "2024-05-01",
    amount: 0,
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

/** A planned (not yet paid) installment — a future obligation, no cash moved. */
function makeInstallment(overrides: Partial<LoanRepayment> = {}): LoanRepayment {
  return makeRepayment({ status: "planned", ...overrides });
}

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  const loan: Loan = {
    id: "L1",
    direction: "taken",
    lender: "הבנק",
    borrower: null,
    loan_date: "2024-01-01",
    loan_method: null,
    repayment_method: null,
    account_id: null,
    documentation: null,
    amount: 10000,
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
    outstanding: 10000,
    scheduledPrincipal: 0,
    scheduledTotal: 0,
    unscheduledPrincipal: 0,
    nextInstallment: null,
    derivedStatus: "active",
    ...overrides,
  };
  // Tests hand in `repayments`; split it the way deriveLoan would so the entry
  // builder sees the same paid/planned lists it gets in production.
  return {
    ...loan,
    paidRepayments:
      overrides.paidRepayments ?? loan.repayments.filter((r) => r.status !== "planned"),
    plannedInstallments:
      overrides.plannedInstallments ?? loan.repayments.filter((r) => r.status === "planned"),
  };
}

const REF = "2024-12-31";

describe("buildLoanEntries — taken loan (borrowed)", () => {
  it("principal received is an inflow with origin 'loan'", () => {
    const [principal] = buildLoanEntries([makeLoan({ amount: 10000 })], REF);
    expect(principal.type).toBe("inflow");
    expect(principal.amount).toBe(10000);
    expect(principal.origin).toBe("loan");
  });

  it("a repayment splits into principal (cash, origin loan) + interest (expense)", () => {
    const loan = makeLoan({
      repayments: [makeRepayment({ id: "r1", amount: 1100, interest_amount: 100 })],
    });
    const entries = buildLoanEntries([loan], REF);
    const repay = entries.find((e) => e.id === "loan_repay:r1");
    const interest = entries.find((e) => e.id === "loan_interest:r1");

    expect(repay?.type).toBe("outflow");
    expect(repay?.amount).toBe(1000); // 1100 − 100 interest
    expect(repay?.origin).toBe("loan");

    expect(interest?.type).toBe("outflow");
    expect(interest?.amount).toBe(100);
    expect(interest?.origin).toBe("expense");
  });
});

describe("buildLoanEntries — given loan (lent)", () => {
  it("principal lent is an outflow; repayment is an inflow; interest is income", () => {
    const loan = makeLoan({
      direction: "given",
      lender: null,
      borrower: "חבר",
      amount: 5000,
      repayments: [makeRepayment({ id: "r2", amount: 550, interest_amount: 50 })],
    });
    const entries = buildLoanEntries([loan], REF);
    const principal = entries.find((e) => e.id === "loan:L1");
    const repay = entries.find((e) => e.id === "loan_repay:r2");
    const interest = entries.find((e) => e.id === "loan_interest:r2");

    expect(principal?.type).toBe("outflow");
    expect(repay?.type).toBe("inflow");
    expect(repay?.amount).toBe(500);
    expect(interest?.type).toBe("inflow");
    expect(interest?.origin).toBe("payment"); // income, hits P&L
    expect(interest?.amount).toBe(50);
  });
});

describe("buildLoanEntries — edge cases", () => {
  it("no principal entry when amount is 0", () => {
    const entries = buildLoanEntries([makeLoan({ amount: 0 })], REF);
    expect(entries.find((e) => e.id === "loan:L1")).toBeUndefined();
  });

  it("a pure-interest repayment emits no principal entry", () => {
    const loan = makeLoan({
      amount: 0,
      repayments: [makeRepayment({ id: "r3", amount: 100, interest_amount: 100 })],
    });
    const entries = buildLoanEntries([loan], REF);
    expect(entries.find((e) => e.id === "loan_repay:r3")).toBeUndefined();
    expect(entries.find((e) => e.id === "loan_interest:r3")?.amount).toBe(100);
  });

  it("stage is 'posted' on/before the reference date and 'scheduled' after it", () => {
    const past = buildLoanEntries([makeLoan({ loan_date: "2024-06-01" })], REF)[0];
    const future = buildLoanEntries([makeLoan({ loan_date: "2025-06-01" })], REF)[0];
    expect(past.stage).toBe("posted");
    expect(future.stage).toBe("scheduled");
  });

  it("loans without an id are skipped", () => {
    expect(buildLoanEntries([makeLoan({ id: "" })], REF)).toHaveLength(0);
  });
});

describe("buildLoanEntries → aggregateProfitLoss integration", () => {
  it("only interest reaches the P&L; principal in/out nets to nothing", () => {
    const loan = makeLoan({
      business_domain: "general_business",
      amount: 10000,
      repayments: [makeRepayment({ id: "r1", amount: 2200, interest_amount: 200 })],
    });
    const pl = aggregateProfitLoss(buildLoanEntries([loan], REF));
    const row = pl.find((r) => r.domain === "general_business");
    // 200 interest is an expense; the 10000 + 2000 principal flows never appear.
    expect(row?.cashExpense).toBe(200);
    expect(row?.cashRevenue).toBe(0);
  });
});

describe("installment plan — planned installments are forecast, not cash", () => {
  it("a planned installment is a scheduled entry that never counts as repaid", () => {
    const loan = deriveLoan({ id: "L1", direction: "taken", amount: 10000 }, [
      makeInstallment({ id: "p1", repayment_date: "2025-01-10", amount: 2000 }),
      makeInstallment({ id: "p2", repayment_date: "2025-02-10", amount: 2000 }),
    ]);
    // The plan does NOT repay anything — outstanding is untouched.
    expect(loan.repaidPrincipal).toBe(0);
    expect(loan.outstanding).toBe(10000);
    expect(loan.scheduledTotal).toBe(4000);
    expect(loan.unscheduledPrincipal).toBe(6000);
    expect(loan.derivedStatus).toBe("active");

    const entry = buildLoanEntries([loan], REF).find((e) => e.id === "loan_planned:p1");
    expect(entry?.type).toBe("outflow"); // a taken loan is repaid outwards
    expect(entry?.amount).toBe(2000);
    expect(entry?.origin).toBe("loan"); // cash forecast only, never P&L
    expect(entry?.stage).toBe("scheduled");
  });

  it("a planned installment past its date is 'pending' (overdue on the calendar)", () => {
    const loan = deriveLoan({ id: "L1", direction: "taken", amount: 10000 }, [
      makeInstallment({ id: "p1", repayment_date: "2024-06-01", amount: 2000 }),
    ]);
    const entry = buildLoanEntries([loan], REF).find((e) => e.id === "loan_planned:p1");
    expect(entry?.stage).toBe("pending");
    expect(overdueInstallments(loan, REF)).toHaveLength(1);
  });

  it("planned installments never reach the P&L", () => {
    const loan = deriveLoan({ id: "L1", direction: "taken", amount: 10000 }, [
      makeInstallment({ id: "p1", repayment_date: "2024-06-01", amount: 2000, interest_amount: 200 }),
    ]);
    const pl = aggregateProfitLoss(buildLoanEntries([loan], REF));
    const row = pl.find((r) => r.domain === "general_business");
    expect(row?.cashExpense ?? 0).toBe(0); // interest only counts once actually paid
  });

  it("paying an installment moves it out of the plan and into the balance", () => {
    const loan = deriveLoan({ id: "L1", direction: "taken", amount: 10000 }, [
      makeRepayment({ id: "p1", repayment_date: "2024-06-01", amount: 2000 }), // now paid
      makeInstallment({ id: "p2", repayment_date: "2024-07-01", amount: 2000 }),
    ]);
    expect(loan.repaidPrincipal).toBe(2000);
    expect(loan.outstanding).toBe(8000);
    expect(loan.scheduledTotal).toBe(2000);
    expect(loan.derivedStatus).toBe("partially_repaid");
    expect(loan.nextInstallment?.id).toBe("p2");

    const entries = buildLoanEntries([loan], REF);
    expect(entries.find((e) => e.id === "loan_repay:p1")?.stage).toBe("posted");
    expect(entries.find((e) => e.id === "loan_planned:p1")).toBeUndefined();
  });

  it("a lent loan's planned installments are expected INCOMING money", () => {
    const loan = deriveLoan({ id: "L1", direction: "given", amount: 5000, borrower: "חבר" }, [
      makeInstallment({ id: "p1", repayment_date: "2025-03-01", amount: 1000 }),
    ]);
    const entry = buildLoanEntries([loan], REF).find((e) => e.id === "loan_planned:p1");
    expect(entry?.type).toBe("inflow");
    expect(entry?.stage).toBe("scheduled");
  });
});

describe("buildInstallmentSchedule", () => {
  it("splits a total into equal monthly installments summing to the total", () => {
    const rows = buildInstallmentSchedule({ total: 100000, count: 5, firstDate: "2026-09-01" });
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.amount)).toEqual([20000, 20000, 20000, 20000, 20000]);
    expect(rows.map((r) => r.date)).toEqual([
      "2026-09-01",
      "2026-10-01",
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
    ]);
  });

  it("puts the rounding remainder on the last installment", () => {
    const rows = buildInstallmentSchedule({ total: 1000, count: 3, firstDate: "2026-01-01" });
    expect(rows.map((r) => r.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBeCloseTo(1000, 6);
  });

  it("clamps a month-end start date to short months", () => {
    const rows = buildInstallmentSchedule({ total: 300, count: 3, firstDate: "2026-01-31" });
    expect(rows.map((r) => r.date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("supports a fixed day interval (weekly / fortnightly)", () => {
    const rows = buildInstallmentSchedule({
      total: 300,
      count: 3,
      firstDate: "2026-01-01",
      intervalDays: 14,
    });
    expect(rows.map((r) => r.date)).toEqual(["2026-01-01", "2026-01-15", "2026-01-29"]);
  });

  it("returns nothing without a total or a date", () => {
    expect(buildInstallmentSchedule({ total: 0, count: 3, firstDate: "2026-01-01" })).toEqual([]);
    expect(buildInstallmentSchedule({ total: 100, count: 3, firstDate: "" })).toEqual([]);
  });
});

describe("deriveLoan / summarizeLoans", () => {
  it("deriveLoan computes repaid principal, outstanding and derived status", () => {
    const loan = deriveLoan(
      { id: "L1", direction: "taken", amount: 1000, status: "active" },
      [makeRepayment({ amount: 330, interest_amount: 30 })] // 300 principal repaid
    );
    expect(loan.repaidPrincipal).toBe(300);
    expect(loan.repaidInterest).toBe(30);
    expect(loan.outstanding).toBe(700);
    expect(loan.derivedStatus).toBe("partially_repaid");
  });

  it("deriveLoan marks a fully-repaid loan as 'repaid'", () => {
    const loan = deriveLoan({ id: "L1", direction: "taken", amount: 1000 }, [
      makeRepayment({ amount: 1000, interest_amount: 0 }),
    ]);
    expect(loan.outstanding).toBe(0);
    expect(loan.derivedStatus).toBe("repaid");
  });

  it("summarizeLoans separates borrowed (debt) from lent (asset) and nets the position", () => {
    const taken = deriveLoan({ id: "A", direction: "taken", amount: 1000 }, []);
    const given = deriveLoan({ id: "B", direction: "given", amount: 400 }, []);
    const summary = summarizeLoans([taken, given]);
    expect(summary.borrowedOutstanding).toBe(1000);
    expect(summary.lentOutstanding).toBe(400);
    expect(summary.netPosition).toBe(-600); // asset − debt
  });

  it("written-off loans carry no live outstanding balance", () => {
    const writtenOff = deriveLoan({ id: "C", direction: "taken", amount: 1000, status: "written_off" }, []);
    const summary = summarizeLoans([writtenOff]);
    expect(summary.borrowedOutstanding).toBe(0);
    expect(summary.borrowedActiveCount).toBe(0);
  });
});
