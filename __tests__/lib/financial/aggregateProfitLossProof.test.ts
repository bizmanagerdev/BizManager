import { describe, it, expect } from "vitest";
import { aggregateProfitLoss, aggregateProfitLossProof } from "@/lib/financial/entries";
import type { FinancialEntry } from "@/lib/financial/types";

// aggregateProfitLossProof lists the exact transactions behind each domain's
// cash/accrual P&L number (the סקירה/לפי-תחום row drill-down). Its whole contract
// is that it MIRRORS aggregateProfitLoss: for every domain and basis, the proof
// items must sum to the same revenue/expense the aggregate reports. These tests
// pin that tie-out plus the per-origin classification.

let seq = 0;
function makeEntry(overrides: Partial<FinancialEntry> = {}): FinancialEntry {
  seq += 1;
  return {
    id: `e${seq}`,
    type: "inflow",
    amount: 0,
    signedAmount: 0,
    businessDomain: "sales",
    domainName: "מכירות",
    flowDate: "2024-05-10",
    recordedDate: "2024-05-10",
    dueDate: null,
    stage: "posted",
    sourceKind: "general",
    sourceId: null,
    sourceLabel: "",
    sourceHref: null,
    description: "",
    origin: "payment",
    reference: null,
    paymentMethod: null,
    paymentMethodLabel: null,
    paymentStatus: null,
    recordedByName: null,
    customerId: null,
    searchText: "",
    ...overrides,
  };
}

function sums(items: ReturnType<typeof aggregateProfitLossProof>[string], basis: "cash" | "accrual") {
  let income = 0;
  let expense = 0;
  for (const it of items) {
    const amount = basis === "accrual" ? it.accrual : it.cash;
    if (it.kind === "income") income += amount;
    else expense += amount;
  }
  return { income, expense };
}

describe("aggregateProfitLossProof — ties out to aggregateProfitLoss", () => {
  it("proof items sum to the aggregate revenue/expense for every domain and basis", () => {
    const entries = [
      makeEntry({ businessDomain: "sales", type: "inflow", origin: "payment", stage: "posted", amount: 1000 }),
      makeEntry({ businessDomain: "sales", type: "inflow", origin: "order_receivable", stage: "pending", amount: 400 }),
      makeEntry({ businessDomain: "sales", type: "outflow", origin: "payment", stage: "posted", amount: 120 }), // refund
      makeEntry({ businessDomain: "sales", type: "outflow", origin: "expense", stage: "posted", amount: 200 }),
      makeEntry({ businessDomain: "sales", type: "outflow", origin: "expense", stage: "pending", amount: 300, expensePaidAmount: 90 }),
      makeEntry({ businessDomain: "general_business", type: "outflow", origin: "worker_payment", stage: "posted", amount: 250 }),
      makeEntry({ businessDomain: "general_business", type: "outflow", origin: "worker_owed", stage: "pending", amount: 150 }),
      makeEntry({ businessDomain: "home", type: "outflow", origin: "expense", stage: "posted", amount: 80 }),
      makeEntry({ businessDomain: null, type: "inflow", origin: "payment", stage: "posted", amount: 60 }),
      makeEntry({ businessDomain: "sales", type: "inflow", origin: "payment", stage: "scheduled", amount: 9999 }), // future — excluded
    ];

    const rows = aggregateProfitLoss(entries);
    const proof = aggregateProfitLossProof(entries);

    for (const row of rows) {
      const key = row.domain ?? "__unassigned__";
      const items = proof[key] ?? [];
      const cash = sums(items, "cash");
      const accrual = sums(items, "accrual");
      expect(cash.income).toBeCloseTo(row.cashRevenue, 6);
      expect(cash.expense).toBeCloseTo(row.cashExpense, 6);
      expect(accrual.income).toBeCloseTo(row.accrualRevenue, 6);
      expect(accrual.expense).toBeCloseTo(row.accrualExpense, 6);
    }
  });

  it("classifies a refund as a negative income item, not an expense", () => {
    const proof = aggregateProfitLossProof([
      makeEntry({ type: "outflow", origin: "payment", stage: "posted", amount: 300 }),
    ]);
    const items = proof["sales"];
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("income");
    expect(items[0].cash).toBe(-300);
    expect(items[0].accrual).toBe(-300);
  });

  it("a partial pending expense carries paid-portion as cash, full as accrual", () => {
    const proof = aggregateProfitLossProof([
      makeEntry({ type: "outflow", origin: "expense", stage: "pending", amount: 400, expensePaidAmount: 150 }),
    ]);
    const item = proof["sales"][0];
    expect(item.kind).toBe("expense");
    expect(item.cash).toBe(150);
    expect(item.accrual).toBe(400);
  });

  it("excludes scheduled (future) and loan-principal entries entirely", () => {
    const proof = aggregateProfitLossProof([
      makeEntry({ type: "inflow", origin: "payment", stage: "scheduled", amount: 500 }),
      makeEntry({ type: "inflow", origin: "loan", stage: "posted", amount: 5000 }),
      makeEntry({ type: "outflow", origin: "loan", stage: "posted", amount: 5000 }),
    ]);
    expect(Object.keys(proof)).toHaveLength(0);
  });

  it("honours the [from, to] flowDate window", () => {
    const proof = aggregateProfitLossProof(
      [
        makeEntry({ flowDate: "2024-04-30", origin: "payment", amount: 100 }),
        makeEntry({ flowDate: "2024-05-15", origin: "payment", amount: 200 }),
        makeEntry({ flowDate: "2024-06-01", origin: "payment", amount: 400 }),
      ],
      { from: "2024-05-01", to: "2024-05-31" }
    );
    expect(proof["sales"]).toHaveLength(1);
    expect(proof["sales"][0].cash).toBe(200);
  });

  it("uses description then sourceLabel then domainName for the item label", () => {
    const proof = aggregateProfitLossProof([
      makeEntry({ origin: "payment", amount: 10, description: "תשלום מזומן", sourceLabel: "מקור" }),
      makeEntry({ origin: "payment", amount: 10, description: "", sourceLabel: "הזמנה 12" }),
      makeEntry({ origin: "payment", amount: 10, description: "", sourceLabel: "", domainName: "מכירות" }),
    ]);
    expect(proof["sales"].map((i) => i.label)).toEqual(["תשלום מזומן", "הזמנה 12", "מכירות"]);
  });
});
