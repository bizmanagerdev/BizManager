import { describe, it, expect } from "vitest";
import { aggregateLoanFlows, buildLoanEntries } from "@/lib/financial/entries";
import { deriveLoan, type LoanRepayment } from "@/lib/loans";

// The reports' "כולל הלוואות" step (owner, 2026-10-20): only loan money that
// really moved inside the period, principal only, the same on every basis.

let seq = 0;
function repayment(overrides: Partial<LoanRepayment> = {}): LoanRepayment {
  seq += 1;
  return {
    id: `r${seq}`,
    loan_id: "L1",
    repayment_date: "2026-10-18",
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

const TODAY = "2026-10-20";
const OCTOBER = { from: "2026-10-01", to: "2026-10-31" };

describe("aggregateLoanFlows", () => {
  it("splits a loan taken and its repayments into money in and money out, with who it's with", () => {
    const loan = deriveLoan({ id: "L1", direction: "taken", lender: "אנשיל אייזנבאך", amount: 70000, loan_date: "2026-10-02" }, [
      repayment({ id: "r1", loan_id: "L1", amount: 40000, repayment_date: "2026-10-18" }),
    ]);
    const flows = aggregateLoanFlows(buildLoanEntries([loan], TODAY), OCTOBER);

    expect(flows.received).toEqual([{ date: "2026-10-02", label: "אנשיל אייזנבאך", amount: 70000 }]);
    expect(flows.repaid).toEqual([{ date: "2026-10-18", label: "אנשיל אייזנבאך", amount: 40000 }]);
    expect(flows.lent).toEqual([]);
    expect(flows.repaidToMe).toEqual([]);
    expect(flows.net).toBe(30000);
  });

  it("a loan given is money out, and what comes back on it is money in", () => {
    const loan = deriveLoan({ id: "G1", direction: "given", borrower: "חבר", amount: 5000, loan_date: "2026-10-05" }, [
      repayment({ id: "r2", loan_id: "G1", amount: 1000, repayment_date: "2026-10-15" }),
    ]);
    const flows = aggregateLoanFlows(buildLoanEntries([loan], TODAY), OCTOBER);

    expect(flows.lent.map((i) => i.amount)).toEqual([5000]);
    expect(flows.repaidToMe.map((i) => i.amount)).toEqual([1000]);
    expect(flows.net).toBe(-4000);
  });

  it("counts principal only — a repayment's interest is already an expense", () => {
    const loan = deriveLoan({ id: "L2", direction: "taken", lender: "בנק", amount: 10000, loan_date: "2026-01-01" }, [
      repayment({ id: "r3", loan_id: "L2", amount: 1100, interest_amount: 100, repayment_date: "2026-10-10" }),
    ]);
    const flows = aggregateLoanFlows(buildLoanEntries([loan], TODAY), OCTOBER);

    expect(flows.repaid.map((i) => i.amount)).toEqual([1000]);
    expect(flows.net).toBe(-1000);
  });

  it("leaves out planned and late installments, money dated after today, and movements outside the period", () => {
    const loan = deriveLoan(
      { id: "L3", direction: "taken", lender: "שכן", amount: 20000, loan_date: "2026-09-15", due_date: "2026-10-11" },
      [
        repayment({ id: "p1", loan_id: "L3", status: "planned", amount: 5000, repayment_date: "2026-10-05" }), // late plan
        repayment({ id: "p2", loan_id: "L3", status: "planned", amount: 5000, repayment_date: "2026-10-25" }), // future plan
        repayment({ id: "r4", loan_id: "L3", amount: 3000, repayment_date: "2026-10-22" }), // paid, but dated after today
        repayment({ id: "r5", loan_id: "L3", amount: 2000, repayment_date: "2026-09-30" }), // before the period
      ]
    );
    const flows = aggregateLoanFlows(buildLoanEntries([loan], TODAY), OCTOBER);

    // The loan itself came in on 15.9 (outside October) and nothing else really moved in October.
    expect(flows).toEqual({ received: [], repaid: [], lent: [], repaidToMe: [], net: 0 });
  });

  it("with no period counts every movement up to today", () => {
    const loan = deriveLoan({ id: "L4", direction: "taken", lender: "שכן", amount: 8000, loan_date: "2025-03-01" }, [
      repayment({ id: "r6", loan_id: "L4", amount: 2000, repayment_date: "2026-02-01" }),
    ]);
    const flows = aggregateLoanFlows(buildLoanEntries([loan], TODAY));

    expect(flows.received.map((i) => i.amount)).toEqual([8000]);
    expect(flows.repaid.map((i) => i.amount)).toEqual([2000]);
    expect(flows.net).toBe(6000);
  });

  it("ignores every non-loan entry", () => {
    const loan = deriveLoan({ id: "L5", direction: "taken", lender: "בנק", amount: 1000, loan_date: "2026-10-03" }, [
      repayment({ id: "r7", loan_id: "L5", amount: 600, interest_amount: 100, repayment_date: "2026-10-12" }),
    ]);
    const entries = buildLoanEntries([loan], TODAY);
    // The interest entry (origin "expense") is in the list but never in the flows.
    expect(entries.some((e) => e.origin === "expense")).toBe(true);
    const flows = aggregateLoanFlows(entries, OCTOBER);
    expect(flows.received.map((i) => i.amount)).toEqual([1000]);
    expect(flows.repaid.map((i) => i.amount)).toEqual([500]);
  });
});
