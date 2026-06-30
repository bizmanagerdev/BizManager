import { describe, it, expect } from "vitest";
import { aggregateProfitLoss } from "@/lib/financial/entries";
import type { FinancialEntry } from "@/lib/financial/types";

// aggregateProfitLoss is a pure reducer over already-built FinancialEntry rows.
// These tests pin the two-basis (cash vs accrual) accounting rules that the P&L
// report depends on. Each case hand-computes the expected numbers.

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

function salesRow(rows: FinancialEntry[]) {
  return aggregateProfitLoss(rows).find((r) => r.domain === "sales");
}

describe("aggregateProfitLoss — revenue side", () => {
  it("a posted payment counts in both cash and accrual revenue", () => {
    const row = salesRow([makeEntry({ type: "inflow", origin: "payment", stage: "posted", amount: 1000 })]);
    expect(row?.cashRevenue).toBe(1000);
    expect(row?.accrualRevenue).toBe(1000);
    expect(row?.cashExpense).toBe(0);
    expect(row?.accrualExpense).toBe(0);
  });

  it("an open receivable (pending) is accrual revenue only — not collected cash", () => {
    const row = salesRow([
      makeEntry({ type: "inflow", origin: "order_receivable", stage: "pending", amount: 800 }),
    ]);
    expect(row?.cashRevenue).toBe(0);
    expect(row?.accrualRevenue).toBe(800);
  });

  it("project_receivable behaves like order_receivable (accrual only)", () => {
    const row = salesRow([
      makeEntry({ type: "inflow", origin: "project_receivable", stage: "pending", amount: 500 }),
    ]);
    expect(row?.accrualRevenue).toBe(500);
    expect(row?.cashRevenue).toBe(0);
  });

  it("a scheduled (future) payment is excluded from both bases", () => {
    const rows = aggregateProfitLoss([
      makeEntry({ type: "inflow", origin: "payment", stage: "scheduled", amount: 999 }),
    ]);
    // no realized/earned activity → row dropped entirely
    expect(rows).toHaveLength(0);
  });
});

describe("aggregateProfitLoss — refunds are contra-revenue (regression)", () => {
  it("a posted refund reduces revenue, never booked as an expense", () => {
    const row = salesRow([
      makeEntry({ type: "inflow", origin: "payment", stage: "posted", amount: 1000 }),
      makeEntry({ type: "outflow", origin: "payment", stage: "posted", amount: 300 }),
    ]);
    expect(row?.cashRevenue).toBe(700);
    expect(row?.accrualRevenue).toBe(700);
    expect(row?.cashExpense).toBe(0);
  });

  it("a pending refund reduces accrual revenue only", () => {
    const row = salesRow([
      makeEntry({ type: "inflow", origin: "payment", stage: "posted", amount: 1000 }),
      makeEntry({ type: "outflow", origin: "payment", stage: "pending", amount: 300 }),
    ]);
    expect(row?.cashRevenue).toBe(1000);
    expect(row?.accrualRevenue).toBe(700);
  });
});

describe("aggregateProfitLoss — expense side", () => {
  it("a posted expense hits both cash and accrual expense", () => {
    const row = salesRow([makeEntry({ type: "outflow", origin: "expense", stage: "posted", amount: 400 })]);
    expect(row?.cashExpense).toBe(400);
    expect(row?.accrualExpense).toBe(400);
  });

  it("a pending unpaid expense accrues in full but no cash goes out", () => {
    const row = salesRow([makeEntry({ type: "outflow", origin: "expense", stage: "pending", amount: 400 })]);
    expect(row?.accrualExpense).toBe(400);
    expect(row?.cashExpense).toBe(0);
  });

  it("a partially-paid pending expense: full accrual, only paid portion as cash", () => {
    const row = salesRow([
      makeEntry({ type: "outflow", origin: "expense", stage: "pending", amount: 400, expensePaidAmount: 150 }),
    ]);
    expect(row?.accrualExpense).toBe(400);
    expect(row?.cashExpense).toBe(150);
  });

  it("worker_payment is a posted wage outflow (cash + accrual)", () => {
    const row = salesRow([
      makeEntry({ type: "outflow", origin: "worker_payment", stage: "posted", amount: 250 }),
    ]);
    expect(row?.cashExpense).toBe(250);
    expect(row?.accrualExpense).toBe(250);
  });

  it("worker_owed is accrued wages only (incurred, unpaid)", () => {
    const row = salesRow([
      makeEntry({ type: "outflow", origin: "worker_owed", stage: "pending", amount: 250 }),
    ]);
    expect(row?.accrualExpense).toBe(250);
    expect(row?.cashExpense).toBe(0);
  });

  it("loan principal (origin 'loan') is ignored — never touches P&L", () => {
    const rows = aggregateProfitLoss([
      makeEntry({ type: "inflow", origin: "loan", stage: "posted", amount: 5000 }),
      makeEntry({ type: "outflow", origin: "loan", stage: "posted", amount: 5000 }),
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe("aggregateProfitLoss — grouping, filtering & sorting", () => {
  it("groups by business domain and flags personal domains", () => {
    const rows = aggregateProfitLoss([
      makeEntry({ businessDomain: "sales", domainName: "מכירות", origin: "payment", amount: 100 }),
      makeEntry({ businessDomain: "home", domainName: "בית", origin: "payment", amount: 50 }),
    ]);
    expect(rows.find((r) => r.domain === "sales")?.isPersonal).toBe(false);
    expect(rows.find((r) => r.domain === "home")?.isPersonal).toBe(true);
  });

  it("a null domain is bucketed under __unassigned__", () => {
    const rows = aggregateProfitLoss([
      makeEntry({ businessDomain: null, domainName: "", origin: "payment", amount: 100 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].domain).toBeNull();
  });

  it("respects the [from, to] flowDate window", () => {
    const rows = aggregateProfitLoss(
      [
        makeEntry({ flowDate: "2024-04-30", origin: "payment", amount: 100 }),
        makeEntry({ flowDate: "2024-05-15", origin: "payment", amount: 200 }),
        makeEntry({ flowDate: "2024-06-01", origin: "payment", amount: 400 }),
      ],
      { from: "2024-05-01", to: "2024-05-31" }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cashRevenue).toBe(200);
  });

  it("sorts domains by accrual net (revenue − expense) descending", () => {
    const rows = aggregateProfitLoss([
      makeEntry({ businessDomain: "sales", domainName: "מכירות", origin: "payment", amount: 100 }),
      makeEntry({ businessDomain: "spaceit", domainName: "ספייסיט", origin: "payment", amount: 900 }),
    ]);
    expect(rows.map((r) => r.domain)).toEqual(["spaceit", "sales"]);
  });
});
