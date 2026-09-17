import { describe, it, expect } from "vitest";
import {
  buildPaymentFlowMeta,
  buildExpenseFlowMeta,
  buildWorkerPaymentFlowMeta,
  buildPaymentEntries,
  aggregateProfitLoss,
  aggregateProfitLossProof,
  isClosedProjectStatus,
  isExcludedProjectStatus,
  isClosedOrderStatus,
  isExcludedOrderStatus,
  matchesEntryFilters,
  buildForecastMonthly,
} from "@/lib/financial/entries";
import { isFutureEntry } from "@/lib/financial/utils";
import type { FinancialEntry, PaymentRow } from "@/lib/financial/types";

// ─── Refund handling (regression: refunds must NOT count as income) ───────────

function makePayment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: "p1", payment_date: "2024-05-01", due_date: null, amount_total: 1000,
    payment_method: "bank_transfer", payment_status: "cleared", reference_number: null,
    business_domain: "sales", notes: null, project_id: null, order_id: null,
    property_id: null, target_type: null, target_id: null, recorded_by: null, ...overrides,
  };
}

function paymentArgs(rows: PaymentRow[]) {
  return {
    paymentRows: rows,
    projectsById: new Map(),
    ordersById: new Map(),
    propertiesById: new Map(),
    propertyCustomersById: new Map(),
    recordedByNames: {},
    customerId: null,
    customerProjectSet: new Set<string>(),
    referenceDate: "2024-06-15",
  };
}

describe("buildPaymentEntries — refund sign", () => {
  it("a positive payment is an inflow with positive signedAmount", () => {
    const [entry] = buildPaymentEntries(paymentArgs([makePayment({ amount_total: 1000 })]));
    expect(entry.type).toBe("inflow");
    expect(entry.amount).toBe(1000);
    expect(entry.signedAmount).toBe(1000);
  });

  it("a negative payment (refund) is an OUTFLOW with negative signedAmount", () => {
    const [entry] = buildPaymentEntries(paymentArgs([makePayment({ id: "r1", amount_total: -300 })]));
    expect(entry.type).toBe("outflow");
    expect(entry.amount).toBe(300);
    expect(entry.signedAmount).toBe(-300);
  });
});

describe("aggregateProfitLoss — refunds are contra-revenue", () => {
  it("a posted refund reduces revenue (not booked as expense)", () => {
    const entries = buildPaymentEntries(
      paymentArgs([
        makePayment({ id: "p1", amount_total: 1000 }),
        makePayment({ id: "r1", amount_total: -300 }),
      ])
    );
    const [pl] = aggregateProfitLoss(entries);
    expect(pl.cashRevenue).toBe(700); // 1000 − 300, NOT 1300
    expect(pl.accrualRevenue).toBe(700);
    expect(pl.cashExpense).toBe(0); // a refund is not an expense
  });
});

describe("aggregateProfitLoss — a card sale sits on two dates", () => {
  // Paid on the card on Sept 20; the clearing company deposits it on Oct 10.
  // Cash = when it reached the bank; accrual (כולל פתוחים) = when the sale was.
  const sale = (referenceDate: string, confirmations?: { available: boolean; confirmed: Set<string> }) =>
    buildPaymentEntries({
      ...paymentArgs([
        makePayment({ id: "c1", payment_method: "credit_card", payment_date: "2024-09-20", amount_total: 700, account_id: "acc-1" }),
      ]),
      referenceDate,
      settlementConfirmations: confirmations,
    });
  const sept = { from: "2024-09-01", to: "2024-09-30" };
  const oct = { from: "2024-10-01", to: "2024-10-31" };

  it("September: in accrual, not in cash", () => {
    const [pl] = aggregateProfitLoss(sale("2024-11-01"), sept);
    expect(pl.accrualRevenue).toBe(700);
    expect(pl.cashRevenue).toBe(0);
  });

  it("October: in cash once the deposit is in, not counted again in accrual", () => {
    const [pl] = aggregateProfitLoss(sale("2024-11-01"), oct);
    expect(pl.cashRevenue).toBe(700);
    expect(pl.accrualRevenue).toBe(0);
  });

  it("an unconfirmed deposit is not cash yet, but the sale still counts in accrual", () => {
    const waiting = { available: true, confirmed: new Set<string>() };
    expect(aggregateProfitLoss(sale("2024-11-01", waiting), oct)).toEqual([]);
    const [pl] = aggregateProfitLoss(sale("2024-10-05"), sept);
    expect(pl.accrualRevenue).toBe(700); // deposit still ahead, sale already made
  });

  it("the proof shows it on each basis's own date", () => {
    const proof = aggregateProfitLossProof(sale("2024-11-01"), { from: "2024-09-01", to: "2024-10-31" });
    const items = Object.values(proof).flat();
    expect(items.find((i) => i.cash === 700)?.date).toBe("2024-10-10");
    expect(items.find((i) => i.accrual === 700)?.date).toBe("2024-09-20");
  });
});

// ─── Projected outflow forecasts (salaries + recurring) — future-only ─────────
// These are injected into the /financial FUTURE/forecast views. The contract the
// engine relies on: a projection is inherently "future" (so it can never fall into
// the actual bucket), the stage filter routes it correctly, and the forecast tab
// buckets it by its month. The "never in the P&L" half is guaranteed structurally
// (getFinancialPageData never feeds projections to aggregateProfitLoss) and locked
// by golden-cases; here we lock the future-side helpers.

function makeProjectedOutflow(overrides: Partial<FinancialEntry> = {}): FinancialEntry {
  return {
    id: "recur_proj:t1:2026-08", type: "outflow", amount: 560, signedAmount: -560,
    businessDomain: null, domainName: "הוצאות קבועות", flowDate: "2026-08-02",
    recordedDate: "2026-08-02", dueDate: "2026-08-02", stage: "scheduled",
    sourceKind: "general", sourceId: null, sourceLabel: "הוצאה קבועה", sourceHref: null,
    description: "ארנונה", origin: "expense", reference: null, paymentMethod: null,
    paymentMethodLabel: null, paymentStatus: "not_paid", recordedByName: null,
    customerId: null, searchText: "ארנונה", ...overrides,
  };
}

describe("projected outflow forecasts — never actual, always future", () => {
  const ref = "2026-07-19";
  const baseFilters = { from: null, to: null, domain: null, sourceId: null, type: null, query: "", referenceDate: ref };

  it("a scheduled (future) projection is future, not actual", () => {
    expect(isFutureEntry(makeProjectedOutflow(), ref)).toBe(true);
  });

  it("a past-due unpaid projection is STILL future (pending ≠ posted)", () => {
    const overdue = makeProjectedOutflow({ flowDate: "2026-06-02", stage: "pending" });
    expect(isFutureEntry(overdue, ref)).toBe(true);
  });

  it("the stage filter routes projections: excluded from actual, kept for future", () => {
    const p = makeProjectedOutflow();
    expect(matchesEntryFilters(p, { ...baseFilters, stage: "actual" })).toBe(false);
    expect(matchesEntryFilters(p, { ...baseFilters, stage: "future" })).toBe(true);
  });

  it("buildForecastMonthly buckets the projection into its own month", () => {
    const fc = buildForecastMonthly([makeProjectedOutflow()], { referenceDate: ref, months: 6 });
    expect(fc.find((f) => f.month === "2026-08")?.change).toBe(-560);
  });
});

// ─── buildPaymentFlowMeta ─────────────────────────────────────────────────────

describe("buildPaymentFlowMeta — regular (non-check) payments", () => {
  const today = "2024-06-15";

  it("uses payment_date as flowDate and stage=posted for past dates", () => {
    const result = buildPaymentFlowMeta(
      { id: "1", payment_date: "2024-05-01", due_date: null, payment_method: "bank_transfer", payment_status: "cleared", amount_total: 500, business_domain: null, notes: null, project_id: null, order_id: null, property_id: null, target_type: null, target_id: null, reference_number: null, recorded_by: null },
      today
    );
    expect(result?.flowDate).toBe("2024-05-01");
    expect(result?.stage).toBe("posted");
  });

  it("stage=scheduled for future payment_date", () => {
    const result = buildPaymentFlowMeta(
      { id: "1", payment_date: "2024-08-01", due_date: null, payment_method: "cash", payment_status: null, amount_total: 500, business_domain: null, notes: null, project_id: null, order_id: null, property_id: null, target_type: null, target_id: null, reference_number: null, recorded_by: null },
      today
    );
    expect(result?.flowDate).toBe("2024-08-01");
    expect(result?.stage).toBe("scheduled");
  });

  it("returns null when payment_date is missing", () => {
    const result = buildPaymentFlowMeta(
      { id: "1", payment_date: null, due_date: null, payment_method: "cash", payment_status: null, amount_total: 500, business_domain: null, notes: null, project_id: null, order_id: null, property_id: null, target_type: null, target_id: null, reference_number: null, recorded_by: null },
      today
    );
    expect(result).toBeNull();
  });
});

describe("buildPaymentFlowMeta — card payments land with the month's deposit", () => {
  // תזרים is money through the account, and card money reaches the account on
  // the 10th of the next month — the same day חשבונות shows it.
  const today = "2024-06-15";
  const card = (over: Partial<PaymentRow> = {}) =>
    makePayment({ payment_method: "credit_card", payment_date: "2024-05-20", due_date: null, account_id: "acc-1", ...over });

  it("dates it on the 10th of the next month, not the day the customer paid", () => {
    const result = buildPaymentFlowMeta(card(), today);
    expect(result?.flowDate).toBe("2024-06-10");
    expect(result?.paymentDate).toBe("2024-05-20");
  });

  it("without the confirmations table, it is in once its day has come", () => {
    expect(buildPaymentFlowMeta(card(), today)?.stage).toBe("posted");
    expect(buildPaymentFlowMeta(card({ payment_date: "2024-06-02" }), today)?.stage).toBe("scheduled");
  });

  it("with the table, only a confirmed deposit is in — a passed, unconfirmed one is late", () => {
    const none = { available: true, confirmed: new Set<string>() };
    const confirmedJune = { available: true, confirmed: new Set(["acc-1|2024-06-10"]) };
    expect(buildPaymentFlowMeta(card(), today, none)?.stage).toBe("pending");
    expect(buildPaymentFlowMeta(card(), today, confirmedJune)?.stage).toBe("posted");
    expect(buildPaymentFlowMeta(card({ payment_date: "2024-06-02" }), today, none)?.stage).toBe("scheduled");
  });

  it("looks the confirmation up under the account chosen on the Grow row", () => {
    const onChosen = { available: true, confirmed: new Set(["acc-bank|2024-06-10"]), depositAccountId: "acc-bank" };
    // Recorded to another account (or none): the deposit is still the bank's.
    expect(buildPaymentFlowMeta(card({ account_id: "acc-cash" }), today, onChosen)?.stage).toBe("posted");
    expect(buildPaymentFlowMeta(card({ account_id: null }), today, onChosen)?.stage).toBe("posted");
  });

  it("moves card income into the month it reached the bank in the cash P&L", () => {
    const entries = buildPaymentEntries(paymentArgs([card({ id: "c1", amount_total: 700 })]));
    expect(entries).toHaveLength(1);
    expect(entries[0].flowDate).toBe("2024-06-10");
    expect(entries[0].recordedDate).toBe("2024-05-20");
  });

  it("a card refund is left on its own day", () => {
    const result = buildPaymentFlowMeta(card({ amount_total: -200 }), today);
    expect(result?.flowDate).toBe("2024-05-20");
  });
});

describe("buildPaymentFlowMeta — check payments (key business rule)", () => {
  const today = "2024-06-15";

  it("uses due_date (not payment_date) as flowDate for checks", () => {
    const result = buildPaymentFlowMeta(
      { id: "1", payment_date: "2024-05-01", due_date: "2024-07-01", payment_method: "check", payment_status: "pending", amount_total: 1000, business_domain: null, notes: null, project_id: null, order_id: null, property_id: null, target_type: null, target_id: null, reference_number: null, recorded_by: null },
      today
    );
    expect(result?.flowDate).toBe("2024-07-01"); // due_date, not payment_date
  });

  it("uncleared check with future due_date → stage=scheduled", () => {
    const result = buildPaymentFlowMeta(
      { id: "1", payment_date: "2024-05-01", due_date: "2024-08-01", payment_method: "check", payment_status: "pending", amount_total: 1000, business_domain: null, notes: null, project_id: null, order_id: null, property_id: null, target_type: null, target_id: null, reference_number: null, recorded_by: null },
      today
    );
    expect(result?.stage).toBe("scheduled");
  });

  it("uncleared check with past due_date → stage=pending (not posted)", () => {
    const result = buildPaymentFlowMeta(
      { id: "1", payment_date: "2024-01-01", due_date: "2024-04-01", payment_method: "check", payment_status: "pending", amount_total: 1000, business_domain: null, notes: null, project_id: null, order_id: null, property_id: null, target_type: null, target_id: null, reference_number: null, recorded_by: null },
      today
    );
    expect(result?.stage).toBe("pending");
  });

  it("cleared check → stage=posted regardless of due_date", () => {
    const result = buildPaymentFlowMeta(
      { id: "1", payment_date: "2024-05-01", due_date: "2024-04-01", payment_method: "check", payment_status: "cleared", amount_total: 1000, business_domain: null, notes: null, project_id: null, order_id: null, property_id: null, target_type: null, target_id: null, reference_number: null, recorded_by: null },
      today
    );
    expect(result?.stage).toBe("posted");
  });

  it("recognizes cheque spelling variant as a check", () => {
    const result = buildPaymentFlowMeta(
      { id: "1", payment_date: "2024-05-01", due_date: "2024-08-01", payment_method: "cheque", payment_status: "pending", amount_total: 1000, business_domain: null, notes: null, project_id: null, order_id: null, property_id: null, target_type: null, target_id: null, reference_number: null, recorded_by: null },
      today
    );
    expect(result?.flowDate).toBe("2024-08-01"); // uses due_date
    expect(result?.stage).toBe("scheduled");
  });
});

describe("buildExpenseFlowMeta", () => {
  it("stage=posted for past expense_date", () => {
    const result = buildExpenseFlowMeta(
      { id: "1", expense_date: "2024-04-01", amount: 200, category: null, description: null, business_domain: null, notes: null, project_id: null, order_id: null, property_id: null, recorded_by: null, payment_status: null, paid_amount: null, payment_method: null },
      "2024-06-15"
    );
    expect(result?.stage).toBe("posted");
    expect(result?.flowDate).toBe("2024-04-01");
  });

  it("stage=scheduled for future expense_date", () => {
    const result = buildExpenseFlowMeta(
      { id: "1", expense_date: "2024-09-01", amount: 200, category: null, description: null, business_domain: null, notes: null, project_id: null, order_id: null, property_id: null, recorded_by: null, payment_status: null, paid_amount: null, payment_method: null },
      "2024-06-15"
    );
    expect(result?.stage).toBe("scheduled");
  });

  it("returns null when expense_date is missing", () => {
    const result = buildExpenseFlowMeta(
      { id: "1", expense_date: null, amount: 200, category: null, description: null, business_domain: null, notes: null, project_id: null, order_id: null, property_id: null, recorded_by: null, payment_status: null, paid_amount: null, payment_method: null },
      "2024-06-15"
    );
    expect(result).toBeNull();
  });
});

describe("buildWorkerPaymentFlowMeta", () => {
  it("stage=posted for past payment date", () => {
    const result = buildWorkerPaymentFlowMeta("2024-04-01", "2024-06-15");
    expect(result?.stage).toBe("posted");
  });

  it("stage=scheduled for future payment date", () => {
    const result = buildWorkerPaymentFlowMeta("2024-09-01", "2024-06-15");
    expect(result?.stage).toBe("scheduled");
  });

  it("returns null for missing date", () => {
    expect(buildWorkerPaymentFlowMeta(null, "2024-06-15")).toBeNull();
  });
});

// ─── Status predicates ────────────────────────────────────────────────────────

describe("project status predicates", () => {
  it("isClosedProjectStatus — only 'completed'", () => {
    expect(isClosedProjectStatus("completed")).toBe(true);
    expect(isClosedProjectStatus("Completed")).toBe(true);
    expect(isClosedProjectStatus("active")).toBe(false);
    expect(isClosedProjectStatus(null)).toBe(false);
  });

  it("isExcludedProjectStatus — cancelled/canceled/quote", () => {
    expect(isExcludedProjectStatus("cancelled")).toBe(true);
    expect(isExcludedProjectStatus("canceled")).toBe(true);
    expect(isExcludedProjectStatus("quote")).toBe(true);
    expect(isExcludedProjectStatus("active")).toBe(false);
  });
});

describe("order status predicates", () => {
  it("isClosedOrderStatus — delivered/completed/closed", () => {
    expect(isClosedOrderStatus("delivered")).toBe(true);
    expect(isClosedOrderStatus("completed")).toBe(true);
    expect(isClosedOrderStatus("closed")).toBe(true);
    expect(isClosedOrderStatus("pending")).toBe(false);
  });

  it("isExcludedOrderStatus — cancelled/canceled", () => {
    expect(isExcludedOrderStatus("cancelled")).toBe(true);
    expect(isExcludedOrderStatus("canceled")).toBe(true);
    expect(isExcludedOrderStatus("pending")).toBe(false);
  });
});

// ─── matchesEntryFilters ──────────────────────────────────────────────────────

function makeEntry(overrides: Partial<FinancialEntry> = {}): FinancialEntry {
  return {
    id: "test:1",
    type: "inflow",
    amount: 100,
    signedAmount: 100,
    businessDomain: "general_business",
    domainName: "שוטף",
    flowDate: "2024-04-01",
    recordedDate: "2024-04-01",
    dueDate: null,
    stage: "posted",
    sourceKind: "general",
    sourceId: null,
    sourceLabel: "",
    sourceHref: null,
    description: "test",
    origin: "payment",
    reference: null,
    paymentMethod: null,
    paymentMethodLabel: null,
    paymentStatus: null,
    recordedByName: null,
    customerId: null,
    searchText: "test income",
    ...overrides,
  };
}

describe("matchesEntryFilters", () => {
  const base = { from: null, to: null, domain: null, sourceId: null, type: null, stage: null, query: "", referenceDate: "2024-06-15" };

  it("passes with no filters active", () => {
    expect(matchesEntryFilters(makeEntry(), base)).toBe(true);
  });

  it("filters by from date", () => {
    expect(matchesEntryFilters(makeEntry({ flowDate: "2024-03-01" }), { ...base, from: "2024-04-01" })).toBe(false);
    expect(matchesEntryFilters(makeEntry({ flowDate: "2024-04-01" }), { ...base, from: "2024-04-01" })).toBe(true);
  });

  it("filters by to date", () => {
    expect(matchesEntryFilters(makeEntry({ flowDate: "2024-08-01" }), { ...base, to: "2024-06-30" })).toBe(false);
    expect(matchesEntryFilters(makeEntry({ flowDate: "2024-06-30" }), { ...base, to: "2024-06-30" })).toBe(true);
  });

  it("filters by type", () => {
    expect(matchesEntryFilters(makeEntry({ type: "inflow" }), { ...base, type: "outflow" })).toBe(false);
    expect(matchesEntryFilters(makeEntry({ type: "outflow" }), { ...base, type: "outflow" })).toBe(true);
  });

  it("filters by text query against searchText", () => {
    expect(matchesEntryFilters(makeEntry({ searchText: "invoice client abc" }), { ...base, query: "abc" })).toBe(true);
    expect(matchesEntryFilters(makeEntry({ searchText: "invoice client abc" }), { ...base, query: "xyz" })).toBe(false);
  });

  it("stage=actual excludes future entries", () => {
    expect(matchesEntryFilters(makeEntry({ flowDate: "2024-09-01", stage: "scheduled" }), { ...base, stage: "actual" })).toBe(false);
    expect(matchesEntryFilters(makeEntry({ flowDate: "2024-04-01", stage: "posted" }), { ...base, stage: "actual" })).toBe(true);
  });

  it("stage=pending keeps only pending entries", () => {
    expect(matchesEntryFilters(makeEntry({ stage: "pending" }), { ...base, stage: "pending" })).toBe(true);
    expect(matchesEntryFilters(makeEntry({ stage: "posted" }), { ...base, stage: "pending" })).toBe(false);
  });
});
