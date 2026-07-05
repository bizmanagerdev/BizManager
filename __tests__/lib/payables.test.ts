import { describe, it, expect } from "vitest";
import { toPaymentCalendarItems, upcomingDueDates } from "@/lib/payables";
import type { FinancialEntry } from "@/lib/financial";

function entry(over: Partial<FinancialEntry>): FinancialEntry {
  return {
    id: "x",
    type: "outflow",
    amount: 100,
    signedAmount: -100,
    businessDomain: "general_business",
    domainName: "שוטף",
    flowDate: "2026-07-10",
    recordedDate: "2026-07-10",
    dueDate: null,
    stage: "scheduled",
    sourceKind: "general",
    sourceId: null,
    sourceLabel: "פעילות שוטפת",
    sourceHref: null,
    description: "תשלום",
    origin: "expense",
    reference: null,
    paymentMethod: null,
    paymentMethodLabel: null,
    paymentStatus: "not_paid",
    recordedByName: null,
    customerId: null,
    searchText: "",
    ...over,
  };
}

describe("toPaymentCalendarItems", () => {
  const today = "2026-07-05";

  it("keeps only outflow entries", () => {
    const items = toPaymentCalendarItems(
      [entry({ id: "a", type: "outflow" }), entry({ id: "b", type: "inflow" })],
      today
    );
    expect(items.map((i) => i.id)).toEqual(["a"]);
  });

  it("flags pending items in the past as overdue, not future ones", () => {
    const items = toPaymentCalendarItems(
      [
        entry({ id: "past", stage: "pending", flowDate: "2026-07-01" }),
        entry({ id: "future", stage: "scheduled", flowDate: "2026-07-20" }),
        entry({ id: "pendingFuture", stage: "pending", flowDate: "2026-07-20" }),
      ],
      today
    );
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId.past.overdue).toBe(true);
    expect(byId.future.overdue).toBe(false);
    expect(byId.pendingFuture.overdue).toBe(false);
  });

  it("passes installment metadata through", () => {
    const [item] = toPaymentCalendarItems(
      [
        entry({
          id: "inst",
          expenseId: "e1",
          expenseInstallmentGroupId: "grp",
          expenseInstallmentIndex: 2,
          expenseInstallmentCount: 4,
        }),
      ],
      today
    );
    expect(item.installmentGroupId).toBe("grp");
    expect(item.installmentIndex).toBe(2);
    expect(item.installmentCount).toBe(4);
    expect(item.expenseId).toBe("e1");
  });

  it("marks non-expense outflows as non-actionable (no expenseId)", () => {
    const [item] = toPaymentCalendarItems(
      [entry({ id: "wage", origin: "worker_owed", expenseId: undefined, sourceHref: "/payroll" })],
      today
    );
    expect(item.expenseId).toBeNull();
    expect(item.sourceHref).toBe("/payroll");
  });

  it("passes workerUserId through for wage entries", () => {
    const [item] = toPaymentCalendarItems(
      [entry({ id: "w", origin: "worker_owed", workerUserId: "user-1" })],
      today
    );
    expect(item.workerUserId).toBe("user-1");
  });
});

describe("upcomingDueDates", () => {
  it("returns the next N occurrences of the due day on/after today", () => {
    // today is the 5th → the 10th of this month is still upcoming.
    expect(upcomingDueDates("2026-07-05", 10, 2)).toEqual(["2026-07-10", "2026-08-10"]);
  });

  it("skips the current month when the due day already passed", () => {
    // today is the 15th → the 10th of this month is gone; start next month.
    expect(upcomingDueDates("2026-07-15", 10, 2)).toEqual(["2026-08-10", "2026-09-10"]);
  });

  it("clamps the due day to the month's last day", () => {
    // day 31 in February clamps to the 28th (2026 is not a leap year).
    expect(upcomingDueDates("2026-02-01", 31, 1)).toEqual(["2026-02-28"]);
  });

  it("rolls over the year", () => {
    expect(upcomingDueDates("2026-12-20", 10, 1)).toEqual(["2027-01-10"]);
  });
});
