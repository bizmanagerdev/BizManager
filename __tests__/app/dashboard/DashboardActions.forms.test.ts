import { describe, it, expect } from "vitest";
import {
  sumOpenOwed,
  sortOpenWorkerDebt,
  buildWorkerPaymentAllocations,
  validateWorkerPaymentForm,
  validateIncomeForm,
  buildIncomePayload,
  validateRegularExpense,
  buildRegularExpensePayload,
} from "@/app/(app)/dashboard/DashboardActions.forms";
import { mapProjectTypeToExpenseDomain } from "@/lib/expenses";
import type { WorkerDebtItemRow } from "@/lib/payroll-center";

// Characterization tests for the dashboard money-form logic: worker-payment debt
// allocation, and the income / regular-expense validators + payload builders.

function debt(over: Partial<WorkerDebtItemRow>): WorkerDebtItemRow {
  return {
    user_id: "u1",
    source_type: "session",
    source_id: "s1",
    owed_amount: 100,
    due_date: null,
    source_date: null,
    ...over,
  } as unknown as WorkerDebtItemRow;
}

describe("sumOpenOwed", () => {
  it("sums owed amounts, flooring negatives at 0", () => {
    expect(sumOpenOwed([debt({ owed_amount: 100 }), debt({ owed_amount: -50 }), debt({ owed_amount: 25 })])).toBe(125);
  });
});

describe("sortOpenWorkerDebt", () => {
  it("keeps only this worker's open debts, oldest first", () => {
    const items = [
      debt({ source_id: "b", user_id: "u1", owed_amount: 50, due_date: "2024-05-10" }),
      debt({ source_id: "other", user_id: "u2", owed_amount: 50, due_date: "2024-01-01" }),
      debt({ source_id: "paid", user_id: "u1", owed_amount: 0 }),
      debt({ source_id: "a", user_id: "u1", owed_amount: 50, due_date: "2024-05-01" }),
    ];
    expect(sortOpenWorkerDebt(items, "u1").map((d) => d.source_id)).toEqual(["a", "b"]);
  });
  it("falls back to source_date when due_date is absent", () => {
    const items = [
      debt({ source_id: "late", source_date: "2024-06-01" }),
      debt({ source_id: "early", source_date: "2024-03-01" }),
    ];
    expect(sortOpenWorkerDebt(items, "u1").map((d) => d.source_id)).toEqual(["early", "late"]);
  });
});

describe("buildWorkerPaymentAllocations", () => {
  it("fills oldest debts first, capping each at its owed amount", () => {
    const items = [debt({ source_id: "a", owed_amount: 60 }), debt({ source_id: "b", owed_amount: 60 })];
    const allocs = buildWorkerPaymentAllocations(100, items);
    expect(allocs).toEqual([
      { source_type: "session", source_id: "a", amount: 60 },
      { source_type: "session", source_id: "b", amount: 40 },
    ]);
  });
  it("leaves a remainder unallocated (an advance) and drops sub-agora slivers", () => {
    const items = [debt({ source_id: "a", owed_amount: 30 })];
    // Paying 100 against 30 owed → only 30 allocated; the other 70 is an advance.
    expect(buildWorkerPaymentAllocations(100, items)).toEqual([{ source_type: "session", source_id: "a", amount: 30 }]);
    // Paying 0 → nothing allocated.
    expect(buildWorkerPaymentAllocations(0, items)).toEqual([]);
  });
  it("rounds applied amounts to the agora", () => {
    const items = [debt({ source_id: "a", owed_amount: 33.336 })];
    expect(buildWorkerPaymentAllocations(33.336, items)[0].amount).toBe(33.34);
  });
});

describe("validateWorkerPaymentForm", () => {
  const ok = { workerPaymentUserId: "u1", workerPaymentDate: "2024-05-01", workerPaymentAmount: "100", accountsCount: 0, workerPaymentAccountId: "" };
  it("passes a complete form", () => {
    expect(validateWorkerPaymentForm(ok)).toBeNull();
  });
  it("flags missing worker / date / amount / account", () => {
    expect(validateWorkerPaymentForm({ ...ok, workerPaymentUserId: "" })).toBe("יש לבחור עובד.");
    expect(validateWorkerPaymentForm({ ...ok, workerPaymentDate: "" })).toBe("יש לבחור תאריך תשלום.");
    expect(validateWorkerPaymentForm({ ...ok, workerPaymentAmount: "0" })).toBe("יש להזין סכום תשלום תקין.");
    expect(validateWorkerPaymentForm({ ...ok, accountsCount: 2, workerPaymentAccountId: "" })).toBe("יש לבחור חשבון לתנועה.");
  });
});

describe("validateIncomeForm", () => {
  const ok = {
    incomeBusinessDomain: "general_business",
    linkedProjectId: "",
    linkedPropertyId: "",
    incomeDate: "2024-05-01",
    incomeMethod: "cash",
    incomeDueDate: "",
    incomeAmount: "500",
    accountsCount: 0,
    incomeAccountId: "",
  };
  it("passes a complete form", () => {
    expect(validateIncomeForm(ok)).toBeNull();
  });
  it("requires a project/property link for those domains", () => {
    expect(validateIncomeForm({ ...ok, incomeBusinessDomain: "logistics_projects" })).toBe("יש לבחור פרויקט לתחום פרויקטים.");
    expect(validateIncomeForm({ ...ok, incomeBusinessDomain: "property_management" })).toBe("יש לבחור נכס לתחום ניהול נכסים.");
  });
  it("requires a due date for a check", () => {
    expect(validateIncomeForm({ ...ok, incomeMethod: "check", incomeDueDate: "" })).toMatch(/תאריך פירעון/);
  });
  it("rejects a non-positive amount and a missing account", () => {
    expect(validateIncomeForm({ ...ok, incomeAmount: "0" })).toBe("יש להזין סכום הכנסה תקין.");
    expect(validateIncomeForm({ ...ok, accountsCount: 1, incomeAccountId: "" })).toBe("יש לבחור חשבון לתנועה.");
  });
});

describe("buildIncomePayload", () => {
  const base = {
    incomeBusinessDomain: "general_business",
    linkedProjectId: "",
    linkedOrderId: "",
    linkedPropertyId: "",
    projectType: null,
    amount: 500,
    incomeDate: "2024-05-01",
    incomeDueDate: "",
    incomeRequiresSplit: false,
    incomeMethod: "cash",
    incomeAccountId: "acc1",
    incomeReference: "  ref ",
    incomeCheckNumber: "",
    incomeNotes: " note ",
    incomeTagIds: ["t1"],
  };
  it("trims optionals, keeps general_business tags, omits a non-check number", () => {
    const p = buildIncomePayload(base);
    expect(p.business_domain).toBe("general_business");
    expect(p.amount_total).toBe(500);
    expect(p.reference_number).toBe("ref");
    expect(p.notes).toBe("note");
    expect(p.check_number).toBeNull();
    expect(p.tag_ids).toEqual(["t1"]);
  });
  it("includes the check number only for a check method", () => {
    expect(buildIncomePayload({ ...base, incomeMethod: "check", incomeCheckNumber: " 1234 " }).check_number).toBe("1234");
  });
  it("maps a project-domain income to the project's expense domain and drops tags", () => {
    const p = buildIncomePayload({ ...base, incomeBusinessDomain: "logistics_projects", linkedProjectId: "p1", projectType: "moving" });
    expect(p.business_domain).toBe(mapProjectTypeToExpenseDomain("moving"));
    expect(p.tag_ids).toEqual([]);
  });
});

describe("validateRegularExpense", () => {
  const ok = {
    expenseDate: "2024-05-01",
    expenseAmount: "250",
    expensePaymentStatus: "paid" as const,
    expensePaymentMethod: "cash",
    accountsCount: 0,
    expenseAccountId: "",
    isProjectExpense: false,
    expenseBilledToCustomer: false,
    expenseBillToCustomerAmount: "",
  };
  it("passes a complete form", () => {
    expect(validateRegularExpense(ok)).toBeNull();
  });
  it("requires a payment method + account only when money moves", () => {
    expect(validateRegularExpense({ ...ok, expensePaymentMethod: "" })).toBe("יש לבחור אמצעי תשלום.");
    expect(validateRegularExpense({ ...ok, accountsCount: 1, expenseAccountId: "" })).toBe("יש לבחור חשבון לתנועה.");
    // not_paid → no method/account needed.
    expect(validateRegularExpense({ ...ok, expensePaymentStatus: "not_paid", expensePaymentMethod: "" })).toBeNull();
  });
  it("requires a positive bill amount when billing a project expense to the customer", () => {
    expect(validateRegularExpense({ ...ok, isProjectExpense: true, expenseBilledToCustomer: true, expenseBillToCustomerAmount: "" })).toBe("יש להזין סכום לחיוב לקוח.");
    expect(validateRegularExpense({ ...ok, isProjectExpense: true, expenseBilledToCustomer: true, expenseBillToCustomerAmount: "120" })).toBeNull();
  });
  it("rejects bad date/amount", () => {
    expect(validateRegularExpense({ ...ok, expenseDate: "" })).toBe("יש למלא את כל שדות החובה.");
    expect(validateRegularExpense({ ...ok, expenseAmount: "-5" })).toBe("יש להזין סכום הוצאה תקין.");
  });
});

describe("buildRegularExpensePayload", () => {
  const base = {
    expenseBusinessDomain: "general_business",
    linkedProjectId: "",
    linkedOrderId: "",
    linkedPropertyId: "",
    expenseAmount: "250",
    finalExpenseCategory: "חומרים",
    expenseDate: "2024-05-01",
    expenseDescription: " desc ",
    expenseNotes: "",
    expenseBilledToCustomer: false,
    expenseBillToCustomerAmount: "",
    expensePaymentStatus: "paid" as const,
    expensePaymentMethod: "cash",
    expenseAccountId: "acc1",
    expenseCategory: "חומרים",
    carsCategory: "רכבים",
    expenseTagIds: ["car1"],
  };
  it("builds a non-project payload (no base-price flags, no car tags)", () => {
    const p = buildRegularExpensePayload(base);
    expect(p.amount).toBe(250);
    expect(p.description).toBe("desc");
    expect(p.included_in_base_price).toBe(false);
    expect(p.billed_to_customer).toBe(false);
    expect(p.bill_to_customer_amount).toBeNull();
    expect(p.tag_ids).toEqual([]); // category isn't the cars category
  });
  it("carves a billed project expense out of the base price", () => {
    const p = buildRegularExpensePayload({
      ...base,
      expenseBusinessDomain: "logistics_projects",
      linkedProjectId: "p1",
      expenseBilledToCustomer: true,
      expenseBillToCustomerAmount: "120",
    });
    expect(p.included_in_base_price).toBe(false);
    expect(p.billed_to_customer).toBe(true);
    expect(p.bill_to_customer_amount).toBe(120);
  });
  it("nulls the payment method when the expense isn't paid, and keeps car tags for the cars category", () => {
    const p = buildRegularExpensePayload({ ...base, expensePaymentStatus: "not_paid", expenseCategory: "רכבים" });
    expect(p.payment_method).toBeNull();
    expect(p.tag_ids).toEqual(["car1"]);
  });
});
