import { describe, it, expect } from "vitest";
import {
  buildPaymentEntries,
  buildExpenseEntries,
  summarizeEntries,
  aggregateProfitLoss,
} from "@/lib/financial/entries";
import type { PaymentRow, ExpenseRow } from "@/lib/financial/types";

// ════════════════════════════════════════════════════════════════════════════
// CHARACTERIZATION harness for the money aggregation (Pillar 1, Phase 0).
//
// These tests pin the CURRENT output of the headline aggregation functions on a
// realistic mixed ledger, so the "one money engine" refactor can't silently
// change a number. When Phase 2 intentionally moves a number (e.g. P&L revenue
// gross→net for VAT), the specific assertion is updated deliberately — that's
// the whole point: every number change becomes a visible, reviewed diff.
//
// NOTE (motivates Phase 1): the engine's PaymentRow has no net_amount/vat_amount
// field — it is structurally blind to VAT and computes revenue on GROSS
// amount_total. That blindness is exactly what Phase 1 fixes.
// ════════════════════════════════════════════════════════════════════════════

const REF_DATE = "2024-06-15";

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

// A representative ledger: collected payment, refund, future-scheduled payment,
// a paid expense, and an incurred-but-unpaid expense.
function ledger() {
  const payments = buildPaymentEntries(
    paymentArgs([
      payment({ id: "p1", amount_total: 1000, payment_date: "2024-05-01" }), // posted inflow
      payment({ id: "r1", amount_total: -300, payment_date: "2024-05-05" }), // refund → outflow
      payment({ id: "p2", amount_total: 500, payment_date: "2024-08-01", payment_status: null }), // scheduled
    ])
  );
  const expenses = buildExpenseEntries(
    expenseArgs([
      expense({ id: "e1", amount: 400, payment_status: "paid", paid_date: "2024-05-10" }), // posted out
      expense({ id: "e2", amount: 200, payment_status: "not_paid", paid_date: null }), // pending (incurred)
    ])
  );
  return [...payments, ...expenses];
}

describe("characterization — summarizeEntries on a mixed ledger", () => {
  it("inflow/outflow/net/count reflect gross cash with refund as outflow", () => {
    const s = summarizeEntries(ledger());
    expect(s.inflow).toBe(1500); // 1000 + 500 scheduled
    // NOTE current behavior: outflow includes the UNPAID expense (e2, 200) too —
    // summarizeEntries buckets by type/sign and ignores stage. Captured as-is.
    expect(s.outflow).toBe(900); // 300 refund + 400 paid expense + 200 unpaid expense
    expect(s.net).toBe(600); // 1000 − 300 + 500 − 400 − 200
    expect(s.count).toBe(5);
  });
});

describe("characterization — aggregateProfitLoss on a mixed ledger", () => {
  const pl = () => aggregateProfitLoss(ledger());

  it("sales revenue = posted collections minus refunds (scheduled excluded from cash)", () => {
    const sales = pl().find((r) => r.domain === "sales")!;
    expect(sales.cashRevenue).toBe(700); // 1000 − 300; the 500 scheduled is NOT yet revenue
    expect(sales.accrualRevenue).toBe(700);
    expect(sales.cashExpense).toBe(0);
  });

  it("general_business expense: paid hits cash, unpaid accrues only", () => {
    const g = pl().find((r) => r.domain === "general_business")!;
    expect(g.cashExpense).toBe(400); // only the paid one
    expect(g.accrualExpense).toBe(600); // paid + incurred-unpaid
    expect(g.cashRevenue).toBe(0);
  });
});
