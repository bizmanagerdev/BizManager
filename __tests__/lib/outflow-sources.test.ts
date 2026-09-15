import { describe, it, expect } from "vitest";
import {
  DEFAULT_REMINDER_WORK_DAYS,
  effectiveReminderWorkDays,
  isMonthlyPlan,
  nextOccurrenceOfDay,
  sourceSettingKey,
} from "@/lib/outflow-sources";
import { applyOutflowSourceAccounts, dropInactiveOutflowSources, type PaymentCalendarItem } from "@/lib/payables";

describe("nextOccurrenceOfDay", () => {
  it("is this month when the day hasn't passed, next month when it has, today when it's today", () => {
    expect(nextOccurrenceOfDay("2026-09-15", 20)).toBe("2026-09-20");
    expect(nextOccurrenceOfDay("2026-09-15", 10)).toBe("2026-10-10");
    expect(nextOccurrenceOfDay("2026-09-15", 15)).toBe("2026-09-15");
  });

  it("clamps a day past the end of the month", () => {
    expect(nextOccurrenceOfDay("2026-02-01", 31)).toBe("2026-02-28");
    expect(nextOccurrenceOfDay("2026-12-31", 31)).toBe("2026-12-31");
  });
});

describe("effectiveReminderWorkDays", () => {
  it("defaults: a card warns 3 work days ahead, the rest are off", () => {
    expect(DEFAULT_REMINDER_WORK_DAYS).toEqual({ salary: 0, loan: 0, card: 3 });
    expect(effectiveReminderWorkDays("card", null)).toBe(3);
    expect(effectiveReminderWorkDays("salary", null)).toBe(0);
    expect(effectiveReminderWorkDays("loan", { reminderWorkDaysBefore: null, accountId: null, isActive: true })).toBe(0);
  });

  it("a stored value wins, including an explicit 0 (off) on a card", () => {
    expect(effectiveReminderWorkDays("card", { reminderWorkDaysBefore: 0, accountId: null, isActive: true })).toBe(0);
    expect(effectiveReminderWorkDays("salary", { reminderWorkDaysBefore: 5, accountId: null, isActive: true })).toBe(5);
  });
});

describe("applyOutflowSourceAccounts", () => {
  const base = {
    date: "2026-09-10", amount: 100, label: "", sourceLabel: "", sourceHref: null, stage: "scheduled" as const,
    paymentStatus: null, domainName: "", expenseId: null, category: null, businessDomain: null, accountId: null,
    paidAmount: null, descriptionRaw: null, notes: null, paymentMethod: null, dueDate: "2026-09-10", paidDate: null,
    overdue: false, installmentGroupId: null, installmentIndex: null, installmentCount: null, expenseProjectId: null,
    expenseOrderId: null, expensePropertyId: null, workerUserId: null, recurringTemplateId: null, recurrenceKey: null,
    variableAmount: false, autoPaid: false, sourceId: null,
  };
  const items: PaymentCalendarItem[] = [
    { ...base, id: "salary_proj:u1:2026-09", origin: "worker_owed", workerUserId: "u1" },
    { ...base, id: "loan_planned:r1", origin: "loan", sourceId: "L1" },
    { ...base, id: "ccharge_proj:ויזה:2026-09", origin: "expense", category: "ויזה", variableAmount: true, autoPaid: true },
    { ...base, id: "ccharge:c9", origin: "expense", category: "ויזה", accountId: "own", autoPaid: true },
    { ...base, id: "expense:e1", origin: "expense", expenseId: "e1" },
  ];
  const settings = new Map([
    [sourceSettingKey("salary", "u1"), { reminderWorkDaysBefore: null, accountId: "acc-s", isActive: true }],
    [sourceSettingKey("loan", "L1"), { reminderWorkDaysBefore: null, accountId: "acc-l", isActive: true }],
    [sourceSettingKey("card", "ויזה"), { reminderWorkDaysBefore: null, accountId: "acc-c", isActive: true }],
  ]);

  it("gives a salary, a loan instalment and a card marker the account set for their source", () => {
    const out = applyOutflowSourceAccounts(items, settings);
    expect(out.map((i) => i.accountId)).toEqual(["acc-s", "acc-l", "acc-c", "own", null]);
  });

  it("is a no-op without settings", () => {
    expect(applyOutflowSourceAccounts(items, new Map())).toBe(items);
  });
});

describe("dropInactiveOutflowSources", () => {
  const base = {
    date: "2026-09-10", amount: 100, label: "", sourceLabel: "", sourceHref: null, stage: "scheduled" as const,
    paymentStatus: null, domainName: "", expenseId: null, category: null, businessDomain: null, accountId: null,
    paidAmount: null, descriptionRaw: null, notes: null, paymentMethod: null, dueDate: "2026-09-10", paidDate: null,
    overdue: false, installmentGroupId: null, installmentIndex: null, installmentCount: null, expenseProjectId: null,
    expenseOrderId: null, expensePropertyId: null, workerUserId: null, recurringTemplateId: null, recurrenceKey: null,
    variableAmount: false, autoPaid: false, sourceId: null,
  };
  const items: PaymentCalendarItem[] = [
    { ...base, id: "salary_proj:u1:2026-09", origin: "worker_owed", workerUserId: "u1" },
    { ...base, id: "worker_payment:p1", origin: "worker_payment", workerUserId: "u1", stage: "posted" },
    { ...base, id: "loan_planned:r1", origin: "loan", sourceId: "L1" },
    { ...base, id: "ccharge_proj:ויזה:2026-10", origin: "expense", category: "ויזה", variableAmount: true, autoPaid: true },
    { ...base, id: "ccharge:c9", origin: "expense", category: "ויזה", autoPaid: true, stage: "posted" },
  ];
  const off = (kind: "salary" | "loan" | "card", key: string) =>
    [sourceSettingKey(kind, key), { reminderWorkDaysBefore: null, accountId: null, isActive: false }] as const;

  it("hides the projections of a switched-off source but never its history", () => {
    const out = dropInactiveOutflowSources(items, new Map([off("salary", "u1"), off("loan", "L1"), off("card", "ויזה")]));
    expect(out.map((i) => i.id)).toEqual(["worker_payment:p1", "ccharge:c9"]);
  });

  it("keeps everything for active or unknown sources", () => {
    expect(dropInactiveOutflowSources(items, new Map([[sourceSettingKey("card", "אחר"), { reminderWorkDaysBefore: null, accountId: null, isActive: false }]]))).toHaveLength(5);
  });
});

describe("isMonthlyPlan — only a loan repaid every month is a monthly commitment", () => {
  it("accepts monthly instalments (including Feb→Mar and 31→30 day months)", () => {
    expect(isMonthlyPlan(["2026-09-18", "2026-10-18", "2026-11-18", "2026-12-18", "2027-01-18"])).toBe(true);
    expect(isMonthlyPlan(["2026-01-31", "2026-02-28", "2026-03-31"])).toBe(true);
  });

  it("rejects a single bullet repayment, a quarterly plan, and gaps of years", () => {
    expect(isMonthlyPlan(["2030-08-30"])).toBe(false);
    expect(isMonthlyPlan(["2026-10-01", "2027-01-01", "2027-04-01"])).toBe(false);
    expect(isMonthlyPlan(["2026-10-01", "2028-10-01"])).toBe(false);
    expect(isMonthlyPlan([])).toBe(false);
  });
});
