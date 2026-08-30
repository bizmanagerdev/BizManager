import { describe, it, expect } from "vitest";
import {
  toPaymentCalendarItems,
  upcomingDueDates,
  loadCardChargeItems,
  loadCardChargedExpenseIds,
} from "@/lib/payables";
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

describe("loadCardChargeItems — real charges + one-per-card forecast", () => {
  function makeSupabase(rows: Record<string, unknown>[]) {
    return {
      from: () => ({
        select: () => Promise.resolve({ data: rows, error: null }),
      }),
    } as never;
  }

  it("shows a real charge as a posted item on its charge_date", async () => {
    const items = await loadCardChargeItems(makeSupabase([
      { id: "c1", statement_id: "s1", card_label: "ויזה 9557", account_id: "acc1", amount: 19878.27, charge_date: "2026-07-05", notes: null },
    ]), { referenceDate: "2026-08-30" });
    const real = items.find((i) => i.id === "ccharge:c1")!;
    expect(real.date).toBe("2026-07-05");
    expect(real.amount).toBe(19878.27);
    expect(real.stage).toBe("posted");
    expect(real.autoPaid).toBe(true);
    expect(real.sourceHref).toBe("/financial/statements/s1");
  });

  it("forecasts the next month from the last real charge, estimated from its amount + day", async () => {
    const items = await loadCardChargeItems(makeSupabase([
      { id: "c1", statement_id: "s1", card_label: "ויזה 9557", account_id: "acc1", amount: 1000, charge_date: "2026-07-05", notes: null },
    ]), { referenceDate: "2026-08-30" });
    const forecast = items.find((i) => i.id === "ccharge_proj:ויזה 9557:2026-08");
    expect(forecast).toBeTruthy();
    expect(forecast!.date).toBe("2026-08-05");
    expect(forecast!.amount).toBe(1000);
    expect(forecast!.variableAmount).toBe(true);
    expect(forecast!.autoPaid).toBe(true);
    // Predicted day (08-05) already passed relative to referenceDate (08-30).
    expect(forecast!.stage).toBe("pending");
    expect(forecast!.overdue).toBe(true);
  });

  it("the forecast is pending (overdue) once its predicted date is in the past", async () => {
    const items = await loadCardChargeItems(makeSupabase([
      { id: "c1", statement_id: "s1", card_label: "ויזה 9557", account_id: "acc1", amount: 1000, charge_date: "2026-06-05", notes: null },
    ]), { referenceDate: "2026-08-30" });
    // Last real charge June 5 → forecasts July 5 (past → pending/overdue) AND August 5 (past → pending/overdue too).
    const july = items.find((i) => i.id === "ccharge_proj:ויזה 9557:2026-07")!;
    const august = items.find((i) => i.id === "ccharge_proj:ויזה 9557:2026-08")!;
    expect(july.stage).toBe("pending");
    expect(july.overdue).toBe(true);
    expect(august.stage).toBe("pending");
  });

  it("a real charge for a period suppresses that period's forecast", async () => {
    const items = await loadCardChargeItems(makeSupabase([
      { id: "c1", statement_id: "s1", card_label: "ויזה 9557", account_id: "acc1", amount: 1000, charge_date: "2026-07-05", notes: null },
      { id: "c2", statement_id: "s2", card_label: "ויזה 9557", account_id: "acc1", amount: 1100, charge_date: "2026-08-06", notes: null },
    ]), { referenceDate: "2026-08-30" });
    expect(items.find((i) => i.id === "ccharge_proj:ויזה 9557:2026-08")).toBeUndefined();
    expect(items.filter((i) => i.id.startsWith("ccharge_proj"))).toHaveLength(1); // only September forecast remains
    expect(items.find((i) => i.id === "ccharge_proj:ויזה 9557:2026-09")).toBeTruthy();
  });

  it("handles multiple cards independently", async () => {
    const items = await loadCardChargeItems(makeSupabase([
      { id: "c1", statement_id: "s1", card_label: "ויזה 9557", account_id: "acc1", amount: 500, charge_date: "2026-08-05", notes: null },
      { id: "c2", statement_id: "s1", card_label: "ויזה 9828", account_id: "acc1", amount: 700, charge_date: "2026-07-27", notes: null },
    ]), { referenceDate: "2026-08-30" });
    expect(items.find((i) => i.id === "ccharge:c1")!.amount).toBe(500);
    expect(items.find((i) => i.id === "ccharge:c2")!.amount).toBe(700);
    expect(items.find((i) => i.id === "ccharge_proj:ויזה 9828:2026-08")).toBeTruthy();
  });

  it("returns nothing when there are no recorded charges yet", async () => {
    expect(await loadCardChargeItems(makeSupabase([]), { referenceDate: "2026-08-30" })).toEqual([]);
  });
});

describe("loadCardChargedExpenseIds — hide itemized detail once a lump charge covers it", () => {
  function makeSupabase(tables: { card_statement_rows: Record<string, unknown>[]; card_statement_charges: Record<string, unknown>[] }) {
    return {
      from: (table: "card_statement_rows" | "card_statement_charges") => ({
        select: () => ({
          not: () => Promise.resolve({ data: tables[table], error: null }),
          then: (onF: (v: { data: unknown; error: null }) => unknown) =>
            Promise.resolve({ data: tables[table], error: null }).then(onF),
        }),
      }),
    } as never;
  }

  it("excludes an expense whose card+statement already has a recorded lump charge", async () => {
    const ids = await loadCardChargedExpenseIds(
      makeSupabase({
        card_statement_rows: [
          { expense_id: "e1", statement_id: "s1", card_label: "ויזה 9557", category: "ויזה 9557" },
          { expense_id: "e2", statement_id: "s1", card_label: "ויזה 9828", category: "ויזה 9828" }, // different card, not charged
        ],
        card_statement_charges: [{ statement_id: "s1", card_label: "ויזה 9557" }],
      })
    );
    expect(ids.has("e1")).toBe(true);
    expect(ids.has("e2")).toBe(false);
  });

  it("returns an empty set when nothing has been charged yet", async () => {
    const ids = await loadCardChargedExpenseIds(
      makeSupabase({
        card_statement_rows: [{ expense_id: "e1", statement_id: "s1", card_label: "ויזה 9557", category: "ויזה 9557" }],
        card_statement_charges: [],
      })
    );
    expect(ids.size).toBe(0);
  });

  it("regression: an edited category never breaks matching — card_label (stable) is what's used, not category", async () => {
    // Exact real-world bug: user retyped a row's category to "ויזה 9557 - דלק"
    // (card name + extra word). Before the fix, grouping/matching read
    // category and treated this as a brand-new phantom card. card_label is
    // untouched by that edit, so the row still correctly matches its real
    // card's recorded lump charge.
    const ids = await loadCardChargedExpenseIds(
      makeSupabase({
        card_statement_rows: [
          { expense_id: "e1", statement_id: "s1", card_label: "ויזה 9557", category: "ויזה 9557 - דלק" },
        ],
        card_statement_charges: [{ statement_id: "s1", card_label: "ויזה 9557" }],
      })
    );
    expect(ids.has("e1")).toBe(true);
  });

  it("falls back to category only for a pre-migration row with no card_label yet", async () => {
    const ids = await loadCardChargedExpenseIds(
      makeSupabase({
        card_statement_rows: [{ expense_id: "e1", statement_id: "s1", card_label: null, category: "ויזה 9557" }],
        card_statement_charges: [{ statement_id: "s1", card_label: "ויזה 9557" }],
      })
    );
    expect(ids.has("e1")).toBe(true);
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
