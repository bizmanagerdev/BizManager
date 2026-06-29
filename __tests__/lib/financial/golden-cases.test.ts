import { describe, it, expect } from "vitest";
import {
  buildPaymentEntries,
  buildExpenseEntries,
  buildWorkerPaymentEntries,
  aggregateProfitLoss,
} from "@/lib/financial/entries";
import type {
  PaymentRow,
  ExpenseRow,
  WorkerPaymentRow,
  WorkerPaymentAllocationRow,
  AttendanceSessionFinanceRow,
} from "@/lib/financial/types";

// ════════════════════════════════════════════════════════════════════════════
// GOLDEN CASES — the money rules, each pinned with a HAND-CALCULATED result.
//
// On 2026-06-29 the live books were reconciled to the agora against the raw
// tables (see db/diagnostics/financial_reconciliation.sql). These tests bottle
// the exact rules that made that reconciliation hold, so any future change that
// would distort income, the cash-vs-expected split, or the wage attribution
// fails CI before it can ship. Each `expect` is a number worked out by hand in
// the comment above it — not copied from engine output.
// ════════════════════════════════════════════════════════════════════════════

const REF_DATE = "2024-06-15"; // "today" for these cases

// ── factories ────────────────────────────────────────────────────────────────
function payment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: "p", payment_date: "2024-05-01", due_date: null, amount_total: 1000,
    payment_method: "bank_transfer", payment_status: "cleared", reference_number: null,
    business_domain: "sales", notes: null, project_id: null, order_id: null,
    property_id: null, target_type: null, target_id: null, recorded_by: null, ...overrides,
  };
}
function expense(overrides: Partial<ExpenseRow> = {}): ExpenseRow {
  return {
    id: "e", expense_date: "2024-05-10", amount: 400, category: "general", description: null,
    business_domain: "general_business", notes: null, project_id: null, order_id: null,
    property_id: null, recorded_by: null, payment_status: "paid", paid_amount: null,
    payment_method: "bank_transfer", paid_date: "2024-05-10", account_id: null, ...overrides,
  };
}
function workerPayment(overrides: Partial<WorkerPaymentRow> = {}): WorkerPaymentRow {
  return {
    id: "wp1", user_id: "u1", payment_date: "2024-05-20", amount: 1500,
    payment_method: "bank_transfer", reference_number: null, notes: null, recorded_by: null, ...overrides,
  };
}
function allocation(overrides: Partial<WorkerPaymentAllocationRow> = {}): WorkerPaymentAllocationRow {
  return {
    id: "a1", worker_payment_id: "wp1", source_type: "session",
    attendance_session_id: "s1", payslip_id: null, amount: 1500, ...overrides,
  };
}
function session(overrides: Partial<AttendanceSessionFinanceRow> = {}): AttendanceSessionFinanceRow {
  return {
    id: "s1", user_id: "u1", clock_in: "2024-05-19", business_domain: "logistics_projects",
    project_id: null, property_id: null, labor_cost: 1500, paid_amount: null,
    owed_amount: null, payment_status: null, ...overrides,
  };
}

function paymentArgs(rows: PaymentRow[]) {
  return {
    paymentRows: rows, projectsById: new Map(), ordersById: new Map(),
    propertiesById: new Map(), propertyCustomersById: new Map(), recordedByNames: {},
    customerId: null, customerProjectSet: new Set<string>(), referenceDate: REF_DATE,
  };
}
function expenseArgs(rows: ExpenseRow[]) {
  return {
    expenseRows: rows, projectsById: new Map(), ordersById: new Map(),
    propertiesById: new Map(), propertyCustomersById: new Map(),
    projectExpenseLinksByExpenseId: new Map(), recordedByNames: {},
    customerId: null, customerProjectSet: new Set<string>(), referenceDate: REF_DATE,
  };
}
function wageArgs(
  allocations: WorkerPaymentAllocationRow[],
  workerPayments: WorkerPaymentRow[],
  sessions: AttendanceSessionFinanceRow[]
) {
  return {
    allocations,
    workerPaymentById: new Map(workerPayments.map((w) => [w.id, w])),
    sessionsById: new Map(sessions.map((s) => [s.id, s])),
    projectsById: new Map(), propertiesById: new Map(), propertyCustomersById: new Map(),
    recordedByNames: {}, customerId: null, customerProjectSet: new Set<string>(), referenceDate: REF_DATE,
  };
}

const domain = (entries: ReturnType<typeof aggregateProfitLoss>, name: string) =>
  entries.find((r) => r.domain === name);

// ── 1. Cash sale, fully paid → counts as cash revenue ─────────────────────────
describe("golden: a cleared payment is cash revenue", () => {
  it("a ₪1,000 cleared bank transfer on a past date = ₪1,000 sales cash revenue", () => {
    const pl = aggregateProfitLoss(
      buildPaymentEntries(paymentArgs([payment({ id: "p1", amount_total: 1000, payment_status: "cleared" })]))
    );
    expect(domain(pl, "sales")!.cashRevenue).toBe(1000);
    expect(domain(pl, "sales")!.accrualRevenue).toBe(1000);
  });
});

// ── 2. Post-dated check (pending, future due) → expected, NOT cash ────────────
// This is the rule behind your 6 pending rows / ₪36,968: money you hold but
// hasn't cleared is tracked as EXPECTED (a future-dated 'scheduled' entry) and
// must contribute nothing to the P&L — not cash, and not accrual either (the
// booked income is carried by the order receivable, so there's no double-count).
describe("golden: a post-dated pending check is expected, not cash", () => {
  it("a ₪680 check, status pending, due in the future = a scheduled entry, ₪0 in the P&L", () => {
    const entries = buildPaymentEntries(paymentArgs([
      payment({ id: "c1", amount_total: 680, payment_method: "check",
        payment_status: "pending", payment_date: "2024-05-01", due_date: "2024-08-25" }),
    ]));
    // It IS tracked — as expected money flowing on its future due_date.
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("inflow");
    expect(entries[0].stage).toBe("scheduled");
    // …but it contributes nothing to the P&L: not cash, not accrual.
    expect(domain(aggregateProfitLoss(entries), "sales")).toBeUndefined();
  });
});

// ── 3. Cleared check (due in the past) → cash ─────────────────────────────────
describe("golden: a cleared check that has come due is cash", () => {
  it("a ₪1,020 check, status cleared, due in the past = ₪1,020 sales cash revenue", () => {
    const pl = aggregateProfitLoss(
      buildPaymentEntries(paymentArgs([
        payment({ id: "c2", amount_total: 1020, payment_method: "check",
          payment_status: "cleared", payment_date: "2024-05-01", due_date: "2024-05-01" }),
      ]))
    );
    expect(domain(pl, "sales")!.cashRevenue).toBe(1020);
  });
});

// ── 4. Refund (negative payment) → contra-revenue, reduces income ─────────────
describe("golden: a refund subtracts from revenue (never adds)", () => {
  it("a ₪1,000 sale and a ₪300 refund = ₪700 sales cash revenue", () => {
    const pl = aggregateProfitLoss(
      buildPaymentEntries(paymentArgs([
        payment({ id: "p1", amount_total: 1000, payment_date: "2024-05-01" }),
        payment({ id: "r1", amount_total: -300, payment_date: "2024-05-05" }),
      ]))
    );
    expect(domain(pl, "sales")!.cashRevenue).toBe(700); // 1000 − 300
  });
});

// ── 5. Expense: paid hits cash, unpaid accrues only ───────────────────────────
describe("golden: a paid expense is cash out; an unpaid one only accrues", () => {
  it("₪400 paid + ₪200 not_paid = ₪400 cash expense, ₪600 accrual expense", () => {
    const pl = aggregateProfitLoss(
      buildExpenseEntries(expenseArgs([
        expense({ id: "e1", amount: 400, payment_status: "paid", paid_date: "2024-05-10" }),
        expense({ id: "e2", amount: 200, payment_status: "not_paid", paid_date: null }),
      ]))
    );
    expect(domain(pl, "general_business")!.cashExpense).toBe(400);
    expect(domain(pl, "general_business")!.accrualExpense).toBe(600);
  });
});

// ── 6. Wages land in the worked domain, not in sales ──────────────────────────
// This is the rule that made projects/general/home carry the wage cost while
// sales/charity/spaceit stayed wage-free in the live reconciliation.
describe("golden: a wage is attributed to the session's domain", () => {
  it("a ₪1,500 wage paid against a logistics_projects session = ₪1,500 projects cash expense, sales untouched", () => {
    const pl = aggregateProfitLoss(
      buildWorkerPaymentEntries(wageArgs(
        [allocation({ amount: 1500 })],
        [workerPayment({ payment_date: "2024-05-20", amount: 1500 })],
        [session({ business_domain: "logistics_projects" })]
      ))
    );
    expect(domain(pl, "logistics_projects")!.cashExpense).toBe(1500);
    expect(domain(pl, "sales")).toBeUndefined(); // no wage leaked into sales
  });

  it("a wage allocation with no session falls back to general_business", () => {
    const pl = aggregateProfitLoss(
      buildWorkerPaymentEntries(wageArgs(
        [allocation({ id: "a2", source_type: "payslip", attendance_session_id: null, payslip_id: "ps1", amount: 2000 })],
        [workerPayment()],
        []
      ))
    );
    expect(domain(pl, "general_business")!.cashExpense).toBe(2000);
  });
});

// ── 7. Composite: income and wages keep their domains separate ────────────────
// A miniature of the live ledger — sales revenue and a project wage must not
// bleed into each other's domain.
describe("golden: domains stay separated in a mixed ledger", () => {
  it("sales cash from a sale + project wage cost don't cross domains", () => {
    const entries = [
      ...buildPaymentEntries(paymentArgs([payment({ id: "p1", amount_total: 1000, business_domain: "sales" })])),
      ...buildWorkerPaymentEntries(wageArgs(
        [allocation({ amount: 1500 })],
        [workerPayment()],
        [session({ business_domain: "logistics_projects" })]
      )),
    ];
    const pl = aggregateProfitLoss(entries);
    expect(domain(pl, "sales")!.cashRevenue).toBe(1000);
    expect(domain(pl, "sales")!.cashExpense).toBe(0);
    expect(domain(pl, "logistics_projects")!.cashExpense).toBe(1500);
    expect(domain(pl, "logistics_projects")!.cashRevenue).toBe(0);
  });
});
