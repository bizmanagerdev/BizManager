import { describe, it, expect } from "vitest";
import {
  dropSettledCardPayments,
  groupSettlementBatches,
  projectRent,
  suppressPromisedReceivables,
  toPromiseItems,
  toSettlementItems,
  type LeaseRow,
  type PaymentPromise,
  type SettlementPaymentRow,
} from "@/lib/receivables-forecast";
import type { PaymentCalendarItem } from "@/lib/payables";

// Money that should arrive but has no ledger row yet. Each of the three has a
// double-count trap, and that is mostly what these tests are about.

const TODAY = "2026-09-16";

function item(over: Partial<PaymentCalendarItem> & { id: string }): PaymentCalendarItem {
  return {
    direction: "in", date: TODAY, amount: 100, label: "x", sourceLabel: "", sourceHref: null,
    stage: "pending", paymentStatus: null, origin: "payment", sourceId: null, domainName: "",
    expenseId: null, category: null, businessDomain: null, accountId: null, paidAmount: null,
    descriptionRaw: null, notes: null, paymentMethod: null, dueDate: TODAY, paidDate: null,
    overdue: false, installmentGroupId: null, installmentIndex: null, installmentCount: null,
    expenseProjectId: null, expenseOrderId: null, expensePropertyId: null, workerUserId: null,
    recurringTemplateId: null, recurrenceKey: null, variableAmount: false, autoPaid: false,
    ...over,
  };
}

function promise(over: Partial<PaymentPromise> & { id: string }): PaymentPromise {
  return { customerId: "c1", orderId: null, projectId: null, amount: 1000, promisedDate: "2026-09-20", notes: null, ...over };
}

describe("toPromiseItems", () => {
  it("puts an open promise on the day it was promised for, named after the customer", () => {
    const [row] = toPromiseItems([promise({ id: "pr1", amount: 5000, promisedDate: "2026-09-20" })], TODAY, new Map([["c1", "דוד לוי"]]));
    expect(row.id).toBe("promise:pr1");
    expect(row.date).toBe("2026-09-20");
    expect(row.amount).toBe(5000);
    expect(row.label).toBe("הבטחת תשלום — דוד לוי");
    expect(row.stage).toBe("scheduled");
    expect(row.overdue).toBe(false);
    expect(row.sourceHref).toBe("/collections?focus=c1");
    expect(row.direction).toBe("in");
  });

  it("a promise whose day has passed is overdue — the same state the broken-promise reminder fires on", () => {
    const [row] = toPromiseItems([promise({ id: "pr2", promisedDate: "2026-09-02" })], TODAY);
    expect(row.stage).toBe("pending");
    expect(row.overdue).toBe(true);
  });

  it("ignores a promise with no amount", () => {
    expect(toPromiseItems([promise({ id: "pr3", amount: 0 })], TODAY)).toEqual([]);
  });
});

describe("suppressPromisedReceivables", () => {
  const receivable = item({ id: "order-receivable:o1", origin: "order_receivable", sourceId: "o1", amount: 5000 });

  it("takes the promised amount off the debt it was made about", () => {
    // Otherwise the same ₪2,000 shows as a balance AND as a promise.
    const out = suppressPromisedReceivables([receivable], [promise({ id: "p", orderId: "o1", amount: 2000 })]);
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(3000);
  });

  it("drops a balance a promise covers in full", () => {
    expect(suppressPromisedReceivables([receivable], [promise({ id: "p", orderId: "o1", amount: 5000 })])).toEqual([]);
  });

  it("adds up several promises against one order", () => {
    const out = suppressPromisedReceivables([receivable], [
      promise({ id: "p1", orderId: "o1", amount: 1000 }),
      promise({ id: "p2", orderId: "o1", amount: 1500 }),
    ]);
    expect(out[0].amount).toBe(2500);
  });

  it("leaves a promise with no order or project alone, and other rows untouched", () => {
    const other = item({ id: "payment:x", amount: 900 });
    const out = suppressPromisedReceivables([receivable, other], [promise({ id: "p", amount: 4000 })]);
    expect(out.map((i) => i.amount)).toEqual([5000, 900]);
  });

  it("matches a project promise to the project's balance", () => {
    const projectDebt = item({ id: "project-receivable:pr1", origin: "project_receivable", sourceId: "pr1", amount: 800 });
    const out = suppressPromisedReceivables([projectDebt], [promise({ id: "p", projectId: "pr1", amount: 300 })]);
    expect(out[0].amount).toBe(500);
  });
});

describe("groupSettlementBatches", () => {
  const row = (over: Partial<SettlementPaymentRow> & { id: string }): SettlementPaymentRow => ({
    accountId: "acc-1", paymentDate: "2026-09-03", dueDate: "2026-10-10", amount: 1000, ...over,
  });

  it("folds every card payment sharing an account and a settlement date into one deposit", () => {
    const batches = groupSettlementBatches([
      row({ id: "a" }),
      row({ id: "b", amount: 500, paymentDate: "2026-09-05" }),
      row({ id: "c", dueDate: "2026-11-10", amount: 700 }),
    ]);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toMatchObject({ dueDate: "2026-10-10", gross: 1500, count: 2 });
    expect(batches[0].paymentIds).toEqual(["a", "b"]);
    expect(batches[1]).toMatchObject({ dueDate: "2026-11-10", gross: 700, count: 1 });
  });

  it("separates batches landing in different accounts on the same day", () => {
    const batches = groupSettlementBatches([row({ id: "a" }), row({ id: "b", accountId: "acc-2" })]);
    expect(batches).toHaveLength(2);
  });

  it("ignores a card payment that isn't deferred — that is ordinary income on its own day", () => {
    expect(groupSettlementBatches([row({ id: "a", dueDate: "2026-09-03" })])).toEqual([]);
  });
});

describe("toSettlementItems", () => {
  const batches = groupSettlementBatches([
    { id: "a", accountId: "acc-1", paymentDate: "2026-09-03", dueDate: "2026-10-10", amount: 1000 },
    { id: "b", accountId: "acc-1", paymentDate: "2026-09-04", dueDate: "2026-10-10", amount: 1000 },
  ]);

  it("shows what actually reaches the bank: one row on the settlement day, net of the fee", () => {
    const [row] = toSettlementItems(batches, 0.14, TODAY);
    expect(row.id).toBe("grow_batch:acc-1:2026-10-10");
    expect(row.date).toBe("2026-10-10");
    expect(row.amount).toBe(1720); // 2,000 less 14%
    expect(row.sourceLabel).toContain("2");
    expect(row.accountId).toBe("acc-1");
    expect(row.stage).toBe("scheduled");
  });

  it("a settlement date already past is money that has landed", () => {
    const past = groupSettlementBatches([
      { id: "a", accountId: "acc-1", paymentDate: "2026-07-03", dueDate: "2026-08-10", amount: 500 },
    ]);
    expect(toSettlementItems(past, 0.14, TODAY)[0].stage).toBe("posted");
  });
});

describe("dropSettledCardPayments", () => {
  it("removes the individual payments a deposit already represents", () => {
    // Otherwise the customer's payment shows on the day they paid AND inside
    // the deposit — the incoming twin of the itemized-card-charge problem.
    const batches = groupSettlementBatches([
      { id: "pay1", accountId: "acc-1", paymentDate: "2026-09-03", dueDate: "2026-10-10", amount: 1000 },
    ]);
    const out = dropSettledCardPayments(
      [item({ id: "payment:pay1", paymentId: "pay1" }), item({ id: "payment:other", paymentId: "other" })],
      batches
    );
    expect(out.map((i) => i.id)).toEqual(["payment:other"]);
  });

  it("changes nothing when there are no batches", () => {
    const items = [item({ id: "payment:pay1", paymentId: "pay1" })];
    expect(dropSettledCardPayments(items, [])).toBe(items);
  });
});

describe("projectRent", () => {
  const lease = (over: Partial<LeaseRow> = {}): LeaseRow => ({
    id: "L1", propertyId: "prop1", customerId: "c1", propertyLabel: "הרצל 5",
    startDate: "2026-01-10", endDate: null, monthlyAmount: 4000, ...over,
  });
  const window = { fromIso: "2026-09-01", toIso: "2026-12-31", todayIso: TODAY };

  it("fills in the months a lease covers that have no payment row, on the lease's own day", () => {
    const rows = projectRent([lease()], new Map(), window);
    expect(rows.map((r) => r.date)).toEqual(["2026-09-10", "2026-10-10", "2026-11-10", "2026-12-10"]);
    expect(rows[0].id).toBe("rent_proj:L1:2026-09");
    expect(rows[0].amount).toBe(4000);
    expect(rows[0].label).toBe("שכר דירה — הרצל 5");
    expect(rows[0].sourceHref).toBe("/properties/prop1");
  });

  it("never doubles a month the office already generated a row for", () => {
    const rows = projectRent([lease()], new Map([["prop1", new Set(["2026-09", "2026-10"])]]), window);
    expect(rows.map((r) => r.id)).toEqual(["rent_proj:L1:2026-11", "rent_proj:L1:2026-12"]);
  });

  it("stops at the end of the lease", () => {
    const rows = projectRent([lease({ endDate: "2026-10-31" })], new Map(), window);
    expect(rows.map((r) => r.date)).toEqual(["2026-09-10", "2026-10-10"]);
  });

  it("starts at the lease, not at the window, when the lease begins later", () => {
    const rows = projectRent([lease({ startDate: "2026-11-05" })], new Map(), window);
    expect(rows.map((r) => r.date)).toEqual(["2026-11-05", "2026-12-05"]);
  });

  it("marks a month whose day has passed as owed", () => {
    const rows = projectRent([lease({ startDate: "2026-01-03" })], new Map(), window);
    expect(rows[0].date).toBe("2026-09-03");
    expect(rows[0].overdue).toBe(true);
    expect(rows[1].overdue).toBe(false);
  });

  it("clamps a 31st lease to short months, and ignores a lease with no rent", () => {
    const rows = projectRent([lease({ startDate: "2026-01-31" })], new Map(), { ...window, toIso: "2026-11-30" });
    expect(rows.map((r) => r.date)).toEqual(["2026-09-30", "2026-10-31", "2026-11-30"]);
    expect(projectRent([lease({ monthlyAmount: 0 })], new Map(), window)).toEqual([]);
  });
});
