import { describe, it, expect } from "vitest";
import { buildLoanEntries, aggregateProfitLoss } from "@/lib/financial/entries";
import { deriveLoan, summarizeLoans } from "@/lib/loans";
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
    ...overrides,
  };
}

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
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
    repaidPrincipal: 0,
    repaidInterest: 0,
    repaidTotal: 0,
    outstanding: 10000,
    derivedStatus: "active",
    ...overrides,
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
