import { describe, it, expect } from "vitest";
import {
  toPaymentCalendarItems,
  upcomingDueDates,
  loadCardChargeItems,
  loadCardChargedExpenseIds,
  loadProjectedRecurringExpenses,
  loadProjectedSalaries,
  expenseSourceHref,
  markVariableTemplateRows,
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

  it("carries the fields an edit dialog needs: payment method + the SCHEDULED date (not the flow date)", () => {
    const [item] = toPaymentCalendarItems(
      [
        entry({
          id: "expense:e1",
          expenseId: "e1",
          stage: "posted",
          paymentStatus: "paid",
          flowDate: "2026-07-14", // paid_date — the day cash left
          recordedDate: "2026-07-10", // expense_date — the schedule
          expensePaymentMethod: "bank_transfer",
        }),
      ],
      today
    );
    expect(item.date).toBe("2026-07-14");
    expect(item.dueDate).toBe("2026-07-10");
    expect(item.paymentMethod).toBe("bank_transfer");
  });
});

describe("markVariableTemplateRows — a generated row from a סכום משתנה template carries an estimate", () => {
  const today = "2026-09-15";
  const variableIds = new Set(["tpl-var"]);

  it("flags unpaid rows of a variable template, so the board shows ~₪ and asks for the real amount", () => {
    const [item] = markVariableTemplateRows(
      toPaymentCalendarItems([entry({ id: "expense:e1", expenseId: "e1", expenseRecurringTemplateId: "tpl-var", stage: "pending", flowDate: "2026-09-10" })], today),
      variableIds
    );
    expect(item.variableAmount).toBe(true);
  });

  it("leaves paid rows alone — they already hold the real amount", () => {
    const [item] = markVariableTemplateRows(
      toPaymentCalendarItems([entry({ id: "expense:e1", expenseId: "e1", expenseRecurringTemplateId: "tpl-var", stage: "posted", paymentStatus: "paid" })], today),
      variableIds
    );
    expect(item.variableAmount).toBe(false);
  });

  it("leaves rows of fixed-amount templates and plain expenses alone", () => {
    const items = markVariableTemplateRows(
      toPaymentCalendarItems(
        [
          entry({ id: "expense:fixed", expenseId: "f1", expenseRecurringTemplateId: "tpl-fixed", stage: "pending" }),
          entry({ id: "expense:plain", expenseId: "p1", stage: "pending" }),
        ],
        today
      ),
      variableIds
    );
    expect(items.map((i) => i.variableAmount)).toEqual([false, false]);
  });
});

describe("expenseSourceHref — 'למקור' lands on the row, not just the page", () => {
  const base = { origin: "expense" as const, expenseId: "e1", id: "expense:e1" };

  it("appends the focus id to a project / property page link", () => {
    expect(expenseSourceHref({ ...base, sourceKind: "project", sourceHref: "/projects/p1" })).toBe(
      "/projects/p1?focus=expense%3Ae1"
    );
    expect(expenseSourceHref({ ...base, sourceKind: "property", sourceHref: "/properties/h1" })).toBe(
      "/properties/h1?focus=expense%3Ae1"
    );
  });

  it("sends a general expense (no source page) to the ledger, which opens it", () => {
    expect(expenseSourceHref({ ...base, sourceKind: "general", sourceHref: null })).toBe(
      "/financial?focus=expense%3Ae1"
    );
  });

  it("sends an order-linked expense to the ledger too (the order page has no expense list)", () => {
    expect(expenseSourceHref({ ...base, sourceKind: "order", sourceHref: "/sales/orders/o1" })).toBe(
      "/financial?focus=expense%3Ae1"
    );
  });

  it("leaves non-expense outflows alone", () => {
    expect(
      expenseSourceHref({ id: "w", origin: "worker_owed", expenseId: null, sourceKind: "general", sourceHref: "/payroll" })
    ).toBe("/payroll");
  });
});

describe("loadProjectedRecurringExpenses — lookback window", () => {
  // A manual monthly bill that started 8 months before the reference date and
  // was never materialized (no expense rows at all).
  function makeSupabase() {
    const tables: Record<string, unknown[]> = {
      recurring_expense_templates: [
        {
          id: "tpl-1",
          template_name: "פנסיה",
          category: "פנסיה",
          amount: 1850,
          is_variable_amount: false,
          auto_paid: false,
          description_template: null,
          notes_template: null,
          business_domain: "general_business",
          account_id: null,
          frequency: "monthly",
          interval_months: 1,
          expense_day_of_month: 15,
          expense_month_of_year: null,
          start_date: "2026-01-15",
          end_date: null,
          created_at: "2026-01-10T00:00:00Z",
          is_active: true,
        },
      ],
      expenses: [],
    };
    return {
      from: (table: string) => ({
        select: () => ({
          eq: () => Promise.resolve({ data: tables[table], error: null }),
          in: () => Promise.resolve({ data: tables[table], error: null }),
        }),
      }),
    } as never;
  }

  it("defaults to three months back (alert rule + ledger forecast keep this)", async () => {
    const items = await loadProjectedRecurringExpenses(makeSupabase(), { referenceDate: "2026-09-15", months: 1 });
    const past = items.filter((i) => i.date < "2026-09-15").map((i) => i.date);
    expect(past).toEqual(["2026-06-15", "2026-07-15", "2026-08-15"]);
    expect(items.every((i) => i.recurringTemplateId === "tpl-1" && i.expenseId === null)).toBe(true);
  });

  it("shows every unpaid period back to the start date when the caller widens it (the calendar passes its scan window)", async () => {
    const items = await loadProjectedRecurringExpenses(makeSupabase(), {
      referenceDate: "2026-09-15",
      months: 1,
      lookbackMonths: 13,
    });
    const past = items.filter((i) => i.date < "2026-09-15").map((i) => i.date);
    // January through August — nothing before the start date.
    expect(past).toEqual([
      "2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15",
      "2026-05-15", "2026-06-15", "2026-07-15", "2026-08-15",
    ]);
    expect(items.filter((i) => i.date < "2026-09-15").every((i) => i.stage === "pending" && i.overdue)).toBe(true);
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

  it("forecasts the next month on the last real charge's day — with NO amount (guessing a card bill is wrong)", async () => {
    const items = await loadCardChargeItems(makeSupabase([
      { id: "c1", statement_id: "s1", card_label: "ויזה 9557", account_id: "acc1", amount: 1000, charge_date: "2026-07-05", notes: null },
    ]), { referenceDate: "2026-08-30" });
    const forecast = items.find((i) => i.id === "ccharge_proj:ויזה 9557:2026-08");
    expect(forecast).toBeTruthy();
    expect(forecast!.date).toBe("2026-08-05");
    expect(forecast!.amount).toBe(0);
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

describe("loadProjectedSalaries — monthly wages with an amount, hourly workers as a משתנה marker", () => {
  function makeSupabase() {
    const tables: Record<string, unknown[]> = {
      salary_agreements: [
        { id: "a1", user_id: "u1", salary_type: "monthly", monthly_salary: 8000, valid_from: "2026-01-01", valid_to: null, due_day_of_next_month: 10 },
        { id: "a2", user_id: "u2", salary_type: "hourly", monthly_salary: null, valid_from: "2026-04-01", valid_to: null, due_day_of_next_month: 10 },
        { id: "a3", user_id: "u3", salary_type: "monthly", monthly_salary: 5000, valid_from: "2025-01-01", valid_to: "2026-06-30", due_day_of_next_month: 10 },
      ],
      users: [
        { id: "u1", full_name: "דוד", email: null, active: true },
        { id: "u2", full_name: "נתן", email: null, active: true },
        { id: "u3", full_name: "ישן", email: null, active: true },
      ],
    };
    return {
      from: (table: string) => ({
        select: () => ({
          eq: () => Promise.resolve({ data: tables[table], error: null }),
          in: () => Promise.resolve({ data: tables[table], error: null }),
          then: (onF: (v: unknown) => unknown) => Promise.resolve({ data: tables[table], error: null }).then(onF),
        }),
      }),
    } as never;
  }

  it("projects the coming pay days: the monthly worker with the amount, the hourly one as משתנה, an expired agreement not at all", async () => {
    const items = await loadProjectedSalaries(makeSupabase(), { referenceDate: "2026-09-15", existingItems: [], months: 1 });
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(Object.keys(byId).sort()).toEqual(["salary_proj:u1:2026-10", "salary_proj:u2:2026-10"]);
    expect(byId["salary_proj:u1:2026-10"]).toMatchObject({ date: "2026-10-10", amount: 8000, variableAmount: false, label: "משכורת דוד" });
    expect(byId["salary_proj:u2:2026-10"]).toMatchObject({ date: "2026-10-10", amount: 0, variableAmount: true, label: "משכורת נתן" });
  });

  it("skips a month that already has a real wage item for that worker", async () => {
    const real = { id: "worker_owed:x", origin: "worker_owed", workerUserId: "u1", date: "2026-10-03" } as never;
    const items = await loadProjectedSalaries(makeSupabase(), { referenceDate: "2026-09-15", existingItems: [real], months: 1 });
    expect(items.map((i) => i.id)).toEqual(["salary_proj:u2:2026-10"]);
  });
});
