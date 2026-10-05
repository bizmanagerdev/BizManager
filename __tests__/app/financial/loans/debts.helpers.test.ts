import { describe, it, expect } from "vitest";
import {
  accountOptions,
  debtsTabItems,
  domainOptions,
  filterDebts,
  groupByKind,
  initialDebtsTab,
  narrowItemToTiming,
  parseTimingFilter,
} from "@/app/(app)/financial/loans/debts.helpers";
import { buildExpenseDebts, buildLoanDebts, type DebtSourceNames, type ExpenseDebtRow } from "@/lib/debts";
import { deriveLoan } from "@/lib/loans";

const TODAY = "2026-10-05";
const NAMES: DebtSourceNames = { projects: new Map(), properties: new Map(), orders: new Map() };

function row(overrides: Partial<ExpenseDebtRow>): ExpenseDebtRow {
  return {
    id: "e",
    expense_date: "2026-09-14",
    amount: 3000,
    paid_amount: null,
    payment_status: "not_paid",
    payment_method: null,
    paid_date: null,
    category: "רכישה",
    description: "יציקה לחצר",
    notes: null,
    business_domain: "property_management",
    account_id: "acc1",
    order_id: null,
    property_id: null,
    project_id: null,
    installment_group_id: null,
    installment_index: null,
    installment_count: null,
    ...overrides,
  };
}

// One late installment and two still to come, a pension bill, and an undated loan.
const items = [
  ...buildExpenseDebts(
    [
      row({ id: "i1", expense_date: "2026-09-15", installment_group_id: "g", installment_index: 1, installment_count: 3 }),
      row({ id: "i2", expense_date: "2026-10-15", installment_group_id: "g", installment_index: 2, installment_count: 3 }),
      row({ id: "i3", expense_date: "2026-11-15", installment_group_id: "g", installment_index: 3, installment_count: 3 }),
      row({ id: "pension", expense_date: "2026-10-07", amount: 5900, category: "פנסיה", description: null, business_domain: "general_business", account_id: null }),
    ],
    NAMES,
    TODAY
  ),
  ...buildLoanDebts([deriveLoan({ id: "L", direction: "taken", amount: 20000, lender: "סלאח" }, [])], TODAY),
];

describe("narrowItemToTiming", () => {
  it("a series filtered to 'late' is only its late installment", () => {
    const series = items.find((i) => i.key === "expense_group:g")!;
    const late = narrowItemToTiming(series, "overdue", TODAY)!;
    expect(late.open).toBe(3000);
    expect(late.expenseLines?.map((l) => l.expenseId)).toEqual(["i1"]);
    const later = narrowItemToTiming(series, "later", TODAY)!;
    expect(later.open).toBe(6000);
    expect(later.dueDate).toBe("2026-10-15");
    expect(narrowItemToTiming(series, "undated", TODAY)).toBeNull();
  });
});

describe("filterDebts", () => {
  it("timing keeps only the matching part of each debt", () => {
    const soon = filterDebts(items, { timing: "soon", domain: "all", search: "" }, TODAY);
    expect(soon.map((i) => [i.key, i.open])).toEqual([["expense:pension", 5900]]);
  });

  it("search, domain, kind and account narrow the list", () => {
    expect(filterDebts(items, { timing: "all", domain: "all", search: "סלאח" }, TODAY).map((i) => i.kind)).toEqual(["loan"]);
    expect(filterDebts(items, { timing: "all", domain: "general_business", search: "" }, TODAY).map((i) => i.key)).toEqual([
      "expense:pension",
      "loan:L",
    ]);
    expect(filterDebts(items, { timing: "all", domain: "all", search: "", kind: "loan" }, TODAY)).toHaveLength(1);
    expect(filterDebts(items, { timing: "all", domain: "all", search: "", account: "none" }, TODAY).map((i) => i.key)).toEqual([
      "expense:pension",
      "loan:L",
    ]);
  });
});

describe("option lists", () => {
  it("domains present, and accounts with 'ללא חשבון' last", () => {
    expect(domainOptions(items).map((o) => o.value).sort()).toEqual(["general_business", "property_management"]);
    expect(accountOptions(items, new Map([["acc1", "עו״ש"]]))).toEqual([
      { value: "acc1", label: "עו״ש" },
      { value: "none", label: "ללא חשבון" },
    ]);
  });

  it("groups by kind in a fixed order, skipping empty kinds", () => {
    expect(groupByKind(items).map((g) => g.kind)).toEqual(["expense", "loan"]);
  });

  it("the חובות tab lists everything but the loans (they have their own tab)", () => {
    expect(debtsTabItems(items).map((i) => i.key)).toEqual(["expense_group:g", "expense:pension"]);
    expect(groupByKind(debtsTabItems(items)).map((g) => g.kind)).toEqual(["expense"]);
  });

  it("parses the timing filter defensively", () => {
    expect(parseTimingFilter("overdue")).toBe("overdue");
    expect(parseTimingFilter("bogus")).toBe("all");
  });
});

describe("initialDebtsTab", () => {
  const loanIds = new Set(["L1"]);
  it("?tab= wins; a loan deep link opens the loans tab; otherwise the debts list", () => {
    expect(initialDebtsTab({ tab: "report", repay: null, focus: null }, loanIds)).toBe("report");
    expect(initialDebtsTab({ tab: null, repay: "L1", focus: null }, loanIds)).toBe("loans");
    expect(initialDebtsTab({ tab: null, repay: null, focus: "L1" }, loanIds)).toBe("loans");
    expect(initialDebtsTab({ tab: null, repay: null, focus: "expense:x" }, loanIds)).toBe("debts");
    expect(initialDebtsTab({ tab: "junk", repay: null, focus: null }, loanIds)).toBe("debts");
  });
});
