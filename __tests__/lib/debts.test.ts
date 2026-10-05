import { describe, it, expect } from "vitest";
import {
  applyCreditToOldest,
  buildExpenseDebts,
  buildLoanDebts,
  buildWageDebts,
  debtTimingFor,
  debtsByAccount,
  debtsByMonth,
  sortDebts,
  totalDebts,
  totalDebtsByKind,
  type DebtSourceNames,
  type ExpenseDebtRow,
} from "@/lib/debts";
import { deriveLoan, type LoanRepayment } from "@/lib/loans";

const TODAY = "2026-10-05";

const NAMES: DebtSourceNames = {
  projects: new Map([["p1", "ייבוא מכולה מניו יארק לארץ"]]),
  properties: new Map([["prop1", "דירה ברחוב הרב"]]),
  orders: new Map([["o1", "פיצה אורי"]]),
};

function expenseRow(overrides: Partial<ExpenseDebtRow> = {}): ExpenseDebtRow {
  return {
    id: "e1",
    expense_date: "2026-09-14",
    amount: 33431,
    paid_amount: 10000,
    payment_status: "partial",
    payment_method: "bank_transfer",
    paid_date: null,
    category: "חשבונית מכולה",
    description: null,
    notes: null,
    business_domain: "logistics_projects",
    account_id: "acc1",
    order_id: null,
    property_id: null,
    project_id: "p1",
    installment_group_id: null,
    installment_index: null,
    installment_count: null,
    ...overrides,
  };
}

describe("debtTimingFor", () => {
  it("late before today, 'soon' from today through 7 days, later after, undated without a date", () => {
    expect(debtTimingFor("2026-10-04", TODAY)).toBe("overdue");
    expect(debtTimingFor("2026-10-05", TODAY)).toBe("soon");
    expect(debtTimingFor("2026-10-12", TODAY)).toBe("soon");
    expect(debtTimingFor("2026-10-13", TODAY)).toBe("later");
    expect(debtTimingFor(null, TODAY)).toBe("undated");
  });
});

describe("buildExpenseDebts", () => {
  it("the container invoice: owed for what's left, late, and linked to its row on the project", () => {
    const [item] = buildExpenseDebts([expenseRow()], NAMES, TODAY);
    expect(item).toMatchObject({
      kind: "expense",
      title: "חשבונית מכולה",
      total: 33431,
      paid: 10000,
      open: 23431,
      timing: "overdue",
      dueDate: "2026-09-14",
      daysLate: 21,
      accountId: "acc1",
      domainName: "פרויקטים",
    });
    expect(item.link).toEqual({
      label: "ייבוא מכולה מניו יארק לארץ",
      href: "/projects/p1?focus=expense%3Ae1",
    });
    expect(item.expenseLines?.[0]).toMatchObject({ paymentStatus: "partial", paidAmount: 10000, open: 23431 });
  });

  it("an installment series is ONE debt with each installment as its own line", () => {
    const series = [
      expenseRow({ id: "i3", expense_date: "2026-09-15", amount: 3000, paid_amount: null, payment_status: "not_paid", installment_group_id: "g1", installment_index: 3, installment_count: 13, description: "יציקה לחצר", category: "רכישה", project_id: null, property_id: "prop1" }),
      expenseRow({ id: "i4", expense_date: "2026-10-15", amount: 3000, paid_amount: null, payment_status: "not_paid", installment_group_id: "g1", installment_index: 4, installment_count: 13, description: "יציקה לחצר", category: "רכישה", project_id: null, property_id: "prop1" }),
      expenseRow({ id: "i5", expense_date: "2026-11-15", amount: 3000, paid_amount: null, payment_status: "not_paid", installment_group_id: "g1", installment_index: 5, installment_count: 13, description: "יציקה לחצר", category: "רכישה", project_id: null, property_id: "prop1" }),
    ];
    const items = buildExpenseDebts(series, NAMES, TODAY);
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item.key).toBe("expense_group:g1");
    expect(item.title).toBe("יציקה לחצר");
    expect(item.subtitle).toBe("רכישה · 3 תשלומים פתוחים");
    expect(item.open).toBe(9000);
    expect(item.timing).toBe("overdue");
    expect(item.dueDate).toBe("2026-09-15");
    expect(item.expenseLines?.map((l) => l.expenseId)).toEqual(["i3", "i4", "i5"]);
    expect(item.link?.href).toBe("/properties/prop1?focus=expense%3Ai3");
  });

  it("a lone installment says which one it is", () => {
    const [item] = buildExpenseDebts(
      [expenseRow({ id: "x", installment_group_id: "g2", installment_index: 2, installment_count: 3, payment_status: "not_paid", paid_amount: null, project_id: null })],
      NAMES,
      TODAY
    );
    expect(item.subtitle).toBe("תשלום 2 מתוך 3");
  });

  it("paid, legacy no-status and fully-covered partial rows are not debts", () => {
    const items = buildExpenseDebts(
      [
        expenseRow({ id: "paid", payment_status: "paid" }),
        expenseRow({ id: "legacy", payment_status: null }),
        expenseRow({ id: "covered", payment_status: "partial", amount: 500, paid_amount: 500 }),
      ],
      NAMES,
      TODAY
    );
    expect(items).toEqual([]);
  });

  it("an order expense links to the order; an unlinked one opens in the ledger", () => {
    const [order, general] = buildExpenseDebts(
      [
        expenseRow({ id: "eo", project_id: null, order_id: "o1", payment_status: "not_paid", paid_amount: null }),
        expenseRow({ id: "eg", project_id: null, payment_status: "not_paid", paid_amount: null, category: "פנסיה" }),
      ],
      NAMES,
      TODAY
    );
    expect(order.link).toEqual({ label: "הזמנה — פיצה אורי", href: "/sales/orders/o1" });
    expect(general.link).toEqual({ label: "בתזרים", href: "/financial?focus=expense%3Aeg" });
  });
});

describe("buildWageDebts", () => {
  const users = new Map([
    ["natan", "נתן סמוכה"],
    ["rosenfeld", "אהרן רוזנפלד"],
    ["einhorn", "איינהורן"],
  ]);
  const projects = new Map([["p1", "פרויקט א"]]);

  it("a worker's debt is their own balance, with unassigned payments taken off the oldest items", () => {
    const [item] = buildWageDebts(
      [{ user_id: "natan", owed_amount: 41290 }],
      [
        { source_type: "payslip", source_id: "s1", user_id: "natan", project_id: null, source_date: "2026-06-01", due_date: "2026-07-10", period_month: "2026-06-01", owed_amount: 2000 },
        { source_type: "payslip", source_id: "s2", user_id: "natan", project_id: "p1", source_date: "2026-08-01", due_date: "2026-09-10", period_month: "2026-08-01", owed_amount: 41290 },
      ],
      users,
      projects,
      TODAY
    );
    expect(item).toMatchObject({ kind: "wages", title: "נתן סמוכה", open: 41290, total: 41290, paid: 0, unallocatedCredit: 2000 });
    // The ₪2,000 unassigned payment covers the oldest item (July) — what's left is due 10 Sep.
    expect(item.parts).toEqual([{ date: "2026-09-10", amount: 41290 }]);
    expect(item.dueDate).toBe("2026-09-10");
    expect(item.link).toEqual({ label: "לכרטיס העובד", href: "/payroll/workers/natan" });
    expect(item.wageLines?.map((l) => l.label)).toEqual(["משכורת 06/2026", "משכורת 08/2026"]);
    expect(item.wageLines?.[1].projectName).toBe("פרויקט א");
  });

  it("an overpaid worker owes nothing — their credit isn't netted against anyone else", () => {
    const items = buildWageDebts(
      [{ user_id: "rosenfeld", owed_amount: -9760 }, { user_id: "einhorn", owed_amount: 8000 }],
      [
        { source_type: "session", source_id: "a", user_id: "rosenfeld", project_id: null, source_date: "2026-09-20", due_date: "2026-09-23", period_month: null, owed_amount: 240 },
        { source_type: "session", source_id: "b", user_id: "einhorn", project_id: null, source_date: "2026-10-01", due_date: "2026-10-05", period_month: null, owed_amount: 8000 },
      ],
      users,
      projects,
      TODAY
    );
    expect(items.map((i) => i.title)).toEqual(["איינהורן"]);
    expect(items[0].wageLines?.[0].label).toBe("משמרת 01/10/26");
  });

  it("a balance the open items don't explain is kept, with no date", () => {
    const [item] = buildWageDebts([{ user_id: "einhorn", owed_amount: 1500 }], [], users, projects, TODAY);
    expect(item.open).toBe(1500);
    expect(item.timing).toBe("undated");
  });
});

function planned(overrides: Partial<LoanRepayment>): LoanRepayment {
  return {
    id: "pl",
    loan_id: "L",
    repayment_date: "2026-12-01",
    amount: 0,
    interest_amount: 0,
    method: null,
    account_id: null,
    notes: null,
    created_at: null,
    status: "planned",
    installment_index: null,
    installment_count: null,
    ...overrides,
  };
}

describe("buildLoanDebts", () => {
  it("a loan with no date and no plan is owed with no date — the one the calendar can't show", () => {
    const loan = deriveLoan({ id: "L1", direction: "taken", amount: 50000, lender: "איהד עטף", notes: "אקסלים/שכר עובדים" }, []);
    const [item] = buildLoanDebts([loan], TODAY);
    expect(item).toMatchObject({
      kind: "loan",
      title: "איהד עטף",
      subtitle: "ללא מועד פירעון · אקסלים/שכר עובדים",
      open: 50000,
      timing: "undated",
      dueDate: null,
      loanId: "L1",
    });
  });

  it("the plan spreads the unpaid principal; the rest falls on the due date", () => {
    const loan = deriveLoan(
      { id: "L2", direction: "taken", amount: 56000, lender: "רוזנפלד", due_date: "2027-01-18" },
      [
        planned({ id: "paid", loan_id: "L2", repayment_date: "2026-05-01", amount: 30000, status: "paid" }),
        planned({ id: "a", loan_id: "L2", repayment_date: "2026-09-18", amount: 5000 }),
        planned({ id: "b", loan_id: "L2", repayment_date: "2026-11-18", amount: 5000 }),
      ]
    );
    const [item] = buildLoanDebts([loan], TODAY);
    expect(item.open).toBe(26000);
    expect(item.parts).toEqual([
      { date: "2026-09-18", amount: 5000 },
      { date: "2026-11-18", amount: 5000 },
      { date: "2027-01-18", amount: 16000 },
    ]);
    expect(item.timing).toBe("overdue");
  });

  it("repaid, written-off and lent loans are not our debt", () => {
    const repaid = deriveLoan({ id: "R", direction: "taken", amount: 100 }, [
      planned({ id: "x", loan_id: "R", repayment_date: "2026-01-01", amount: 100, status: "paid" }),
    ]);
    const writtenOff = deriveLoan({ id: "W", direction: "taken", amount: 100, status: "written_off" }, []);
    const lent = deriveLoan({ id: "G", direction: "given", amount: 100 }, []);
    expect(buildLoanDebts([repaid, writtenOff, lent], TODAY)).toEqual([]);
  });
});

describe("applyCreditToOldest", () => {
  it("pays the oldest parts first and drops what it covers", () => {
    expect(
      applyCreditToOldest(
        [
          { date: "2026-09-01", amount: 100 },
          { date: "2026-08-01", amount: 50 },
          { date: null, amount: 30 },
        ],
        120
      )
    ).toEqual([
      { date: "2026-09-01", amount: 30 },
      { date: null, amount: 30 },
    ]);
  });
});

describe("totals and the report", () => {
  const items = [
    ...buildExpenseDebts(
      [
        expenseRow(), // 23,431 late (14 Sep)
        expenseRow({ id: "soon", expense_date: "2026-10-08", amount: 1000, paid_amount: null, payment_status: "not_paid", project_id: null, account_id: null }),
        expenseRow({ id: "later", expense_date: "2026-12-20", amount: 2000, paid_amount: null, payment_status: "not_paid", project_id: null, account_id: "acc2" }),
      ],
      NAMES,
      TODAY
    ),
    ...buildLoanDebts([deriveLoan({ id: "L1", direction: "taken", amount: 5000, lender: "ריאד" }, [])], TODAY),
  ];

  it("totals split every shekel into exactly one timing", () => {
    const totals = totalDebts(items, TODAY);
    expect(totals).toMatchObject({ open: 31431, overdue: 23431, soon: 1000, later: 2000, undated: 5000, count: 4 });
    const byKind = totalDebtsByKind(items, TODAY);
    expect(byKind.expense.open).toBe(26431);
    expect(byKind.loan.undated).toBe(5000);
    expect(byKind.wages.count).toBe(0);
  });

  it("by account: named accounts, and 'ללא חשבון' for the rest", () => {
    const rows = debtsByAccount(items, new Map([["acc1", "עו״ש"], ["acc2", "כרטיס"]]), TODAY);
    expect(rows.map((r) => [r.label, r.totals.open])).toEqual([
      ["עו״ש", 23431],
      ["ללא חשבון", 6000],
      ["כרטיס", 2000],
    ]);
  });

  it("by month: late, the next months, later, and no date", () => {
    const rows = debtsByMonth(items, TODAY, 3);
    expect(rows.map((r) => [r.key, r.amount])).toEqual([
      ["overdue", 23431],
      ["2026-10", 1000],
      ["2026-11", 0],
      ["2026-12", 2000],
      ["later", 0],
      ["undated", 5000],
    ]);
  });

  it("most urgent first", () => {
    expect(sortDebts(items).map((i) => i.key)).toEqual(["expense:e1", "expense:soon", "expense:later", "loan:L1"]);
  });
});
