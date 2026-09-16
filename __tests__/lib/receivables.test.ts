import { describe, it, expect } from "vitest";
import {
  effectiveReceivableDate,
  incomeSourceHref,
  isRejectedEntry,
  receivableSourceIds,
  redateReceivable,
  toIncomeCalendarItems,
  type ReceivableTerms,
} from "@/lib/receivables";
import type { FinancialEntry } from "@/lib/financial/types";

// The incoming board's mapping. What matters here is the three things the money
// engine gets wrong for a calendar — receivable dates collapsed to today,
// bounced money counted as income, and open orders reading as late — plus the
// plain pass-through of everything that was already right.

const TODAY = "2026-09-16";

function entry(over: Partial<FinancialEntry> & { id: string }): FinancialEntry {
  return {
    type: "inflow",
    amount: 1000,
    signedAmount: 1000,
    businessDomain: "sales",
    domainName: "מכירות",
    flowDate: TODAY,
    recordedDate: null,
    dueDate: null,
    stage: "pending",
    sourceKind: "order",
    sourceId: null,
    sourceLabel: "הזמנה 4f3c1b2a",
    sourceHref: "/sales/orders/o1",
    description: "יתרת לקוח לתשלום",
    origin: "payment",
    reference: null,
    paymentMethod: null,
    paymentMethodLabel: null,
    paymentStatus: null,
    recordedByName: null,
    customerId: null,
    searchText: "",
    ...over,
  };
}

const terms = (over: Partial<ReceivableTerms> = {}): ReceivableTerms => ({
  dueDate: null,
  paymentTerms: null,
  status: null,
  ...over,
});

describe("isRejectedEntry", () => {
  it("catches a bounced payment whatever the casing", () => {
    expect(isRejectedEntry(entry({ id: "p1", paymentStatus: "rejected" }))).toBe(true);
    expect(isRejectedEntry(entry({ id: "p2", paymentStatus: " Rejected " }))).toBe(true);
    expect(isRejectedEntry(entry({ id: "p3", paymentStatus: "pending" }))).toBe(false);
    expect(isRejectedEntry(entry({ id: "p4", paymentStatus: null }))).toBe(false);
  });
});

describe("effectiveReceivableDate", () => {
  const e = entry({ id: "order-receivable:o1", origin: "order_receivable", recordedDate: "2026-06-10" });

  it("prefers the order's stored due date", () => {
    expect(effectiveReceivableDate(e, terms({ dueDate: "2026-08-01", paymentTerms: "eom_60" }))).toBe("2026-08-01");
  });

  it("falls back to what the payment terms imply from the order's own date", () => {
    // שוטף+30 on a June order = end of June, then 30 days.
    expect(effectiveReceivableDate(e, terms({ paymentTerms: "eom_30" }))).toBe("2026-07-30");
    expect(effectiveReceivableDate(e, terms({ paymentTerms: "eom" }))).toBe("2026-06-30");
  });

  it("treats no terms as due on the reference date, and gives up with no date at all", () => {
    expect(effectiveReceivableDate(e, terms())).toBe("2026-06-10");
    expect(effectiveReceivableDate(e, null)).toBe("2026-06-10");
    expect(effectiveReceivableDate(entry({ id: "x", origin: "order_receivable" }), terms())).toBeNull();
  });
});

describe("redateReceivable", () => {
  it("moves a past-due receivable off today and onto the day it was due", () => {
    // This is the engine's defect: flowDate collapsed to the reference date.
    const e = entry({
      id: "order-receivable:o1", origin: "order_receivable", sourceId: "o1",
      recordedDate: "2026-06-10", flowDate: TODAY, stage: "scheduled",
    });
    const out = redateReceivable(e, terms({ paymentTerms: "eom_30", status: "delivered" }), TODAY);
    expect(out.flowDate).toBe("2026-07-30");
    expect(out.dueDate).toBe("2026-07-30");
    expect(out.stage).toBe("pending"); // the day has passed
  });

  it("keeps a future receivable scheduled", () => {
    const e = entry({ id: "order-receivable:o2", origin: "order_receivable", sourceId: "o2", recordedDate: "2026-09-10" });
    const out = redateReceivable(e, terms({ paymentTerms: "eom_30", status: "delivered" }), TODAY);
    expect(out.flowDate).toBe("2026-10-30");
    expect(out.stage).toBe("scheduled");
  });

  it("never makes an OPEN order late — goods undelivered, payment not forced", () => {
    const e = entry({ id: "order-receivable:o3", origin: "order_receivable", sourceId: "o3", recordedDate: "2026-01-05" });
    const out = redateReceivable(e, terms({ status: "processing" }), TODAY);
    expect(out.flowDate).toBe("2026-01-05");
    expect(out.stage).toBe("scheduled");
  });

  it("a completed project's balance does go late", () => {
    const e = entry({
      id: "project-receivable:p1", origin: "project_receivable", sourceId: "p1",
      recordedDate: "2026-05-01", businessDomain: "logistics_projects",
    });
    const out = redateReceivable(e, terms({ status: "completed" }), TODAY);
    expect(out.stage).toBe("pending");
  });

  it("leaves a plain payment alone", () => {
    const e = entry({ id: "payment:x", origin: "payment", flowDate: "2026-09-20", stage: "scheduled" });
    expect(redateReceivable(e, terms({ dueDate: "2026-01-01" }), TODAY)).toEqual(e);
  });
});

describe("receivableSourceIds", () => {
  it("collects the order and project ids that need terms, without duplicates", () => {
    const got = receivableSourceIds([
      entry({ id: "order-receivable:o1", origin: "order_receivable", sourceId: "o1" }),
      entry({ id: "order-receivable:o1b", origin: "order_receivable", sourceId: "o1" }),
      entry({ id: "project-receivable:p1", origin: "project_receivable", sourceId: "p1" }),
      entry({ id: "payment:x", origin: "payment", sourceId: "o9" }),
    ]);
    expect(got.orderIds).toEqual(["o1"]);
    expect(got.projectIds).toEqual(["p1"]);
  });
});

describe("incomeSourceHref", () => {
  it("sends a check to its row in the checks register", () => {
    expect(incomeSourceHref(entry({ id: "payment:abc", paymentMethod: "check" }))).toBe("/checks?focus=abc");
  });
  it("sends everything else to its own source page", () => {
    expect(incomeSourceHref(entry({ id: "payment:abc", paymentMethod: "bank_transfer" }))).toBe("/sales/orders/o1");
    expect(incomeSourceHref(entry({ id: "project-receivable:p1", origin: "project_receivable", sourceHref: "/projects/p1" }))).toBe("/projects/p1");
  });
});

describe("toIncomeCalendarItems", () => {
  const entries = [
    entry({ id: "payment:pay1", flowDate: "2026-09-20", amount: 5000, description: "צ׳ק", paymentMethod: "check", stage: "scheduled", paymentStatus: "pending", customerId: "c1", reference: "12345" }),
    entry({ id: "payment:bounced", flowDate: "2026-09-21", amount: 900, paymentStatus: "rejected" }),
    entry({ id: "order-receivable:o1", origin: "order_receivable", sourceId: "o1", recordedDate: "2026-06-10", flowDate: TODAY, stage: "scheduled", amount: 2000, customerId: "c1" }),
    entry({ id: "expense:e1", type: "outflow", origin: "expense", amount: 700 }),
  ];
  const items = toIncomeCalendarItems(entries, TODAY, {
    terms: new Map([["o1", terms({ paymentTerms: "eom_30", status: "delivered" })]]),
    customerNames: new Map([["c1", "מאפיית לחם"]]),
  });

  it("keeps inflows only, drops bounced money, and marks every row incoming", () => {
    expect(items.map((i) => i.id)).toEqual(["payment:pay1", "order-receivable:o1"]);
    expect(items.every((i) => i.direction === "in")).toBe(true);
  });

  it("headlines the row with WHO owes it, not with what kind of row it is", () => {
    // A day showing five rows of "הכנסה מתוכננת מלקוח" is unusable; the
    // category and the order belong on the meta line under the name.
    expect(items[1].label).toBe("מאפיית לחם");
    // "הזמנה 4f3c1b2a" is an id fragment; with a name to show it is noise.
    expect(items[1].sourceLabel).toBe("יתרת לקוח לתשלום");
    expect(items[1].customerName).toBe("מאפיית לחם");
  });

  it("keeps the order reference when there is no customer name to show instead", () => {
    const [row] = toIncomeCalendarItems([entry({ id: "payment:p7", description: "תקבול" })], TODAY);
    expect(row.label).toBe("תקבול");
    expect(row.sourceLabel).toBe("הזמנה 4f3c1b2a");
  });

  it("falls back to the project or property name when there is no customer", () => {
    const [row] = toIncomeCalendarItems(
      [entry({ id: "payment:p9", sourceKind: "project", sourceLabel: "מטבח הרצל", sourceHref: "/projects/x", description: "תקבול" })],
      TODAY
    );
    expect(row.label).toBe("מטבח הרצל");
    expect(row.sourceLabel).toBe("תקבול");
  });

  it("keeps the description as the headline for income with nobody behind it", () => {
    const [row] = toIncomeCalendarItems(
      [entry({ id: "payment:p8", sourceKind: "general", sourceLabel: "פעילות שוטפת", description: "הכנסה" })],
      TODAY
    );
    expect(row.label).toBe("הכנסה");
    expect(row.sourceLabel).toBe("פעילות שוטפת");
  });

  it("carries the payment row id and its reference so the row can be acted on", () => {
    expect(items[0].paymentId).toBe("pay1");
    expect(items[0].reference).toBe("12345");
    expect(items[0].sourceHref).toBe("/checks?focus=pay1");
    // A receivable has no payment row yet.
    expect(items[1].paymentId).toBeNull();
  });

  it("dates the receivable by its terms and flags it overdue once that day has passed", () => {
    expect(items[1].date).toBe("2026-07-30");
    expect(items[1].overdue).toBe(true);
    // The future check is not.
    expect(items[0].date).toBe("2026-09-20");
    expect(items[0].overdue).toBe(false);
  });

  it("fills none of the expense-only fields, so the shared card offers no expense action", () => {
    expect(items.every((i) => i.expenseId === null && i.recurringTemplateId === null && !i.autoPaid)).toBe(true);
  });
});
