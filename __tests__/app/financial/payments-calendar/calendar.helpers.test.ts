import { describe, it, expect } from "vitest";
import {
  amountLabel,
  buildSplitRequestBody,
  compactAmount,
  dayStageCompactText,
  partialPaidNote,
} from "@/app/(app)/financial/payments-calendar/calendar.helpers";
import type { PaymentCalendarItem } from "@/lib/payables";

function item(overrides: Partial<PaymentCalendarItem> = {}): PaymentCalendarItem {
  return {
    id: "expense:e1",
    direction: "out",
    date: "2026-09-14",
    amount: 23431,
    totalAmount: 33431,
    label: "חשבונית מכולה",
    sourceLabel: "פרויקט",
    sourceHref: "/projects/p1",
    stage: "pending",
    paymentStatus: "partial",
    origin: "expense",
    sourceId: "p1",
    domainName: "פרויקטים",
    expenseId: "e1",
    category: "חשבונית מכולה",
    businessDomain: "logistics_projects",
    accountId: "acc1",
    paidAmount: 10000,
    descriptionRaw: null,
    notes: null,
    paymentMethod: "bank_transfer",
    dueDate: "2026-09-14",
    paidDate: null,
    overdue: true,
    installmentGroupId: null,
    installmentIndex: null,
    installmentCount: null,
    expenseProjectId: "p1",
    expenseOrderId: null,
    expensePropertyId: null,
    workerUserId: null,
    recurringTemplateId: null,
    recurrenceKey: null,
    variableAmount: false,
    autoPaid: false,
    ...overrides,
  };
}

const norm = (s: string | null) => (s ?? "").replace(/\s/g, " ");

describe("partialPaidNote", () => {
  it("says what a partly-paid bill was out of", () => {
    const note = norm(partialPaidNote(item()));
    expect(note).toContain("שולם");
    expect(note).toContain("10,000");
    expect(note).toContain("33,431");
  });

  it("is null for a bill shown at its full amount", () => {
    expect(partialPaidNote(item({ totalAmount: null, amount: 500 }))).toBeNull();
    expect(partialPaidNote(item({ totalAmount: undefined }))).toBeNull();
  });
});

describe("buildSplitRequestBody", () => {
  it("keeps the project link, account and the part already paid as a paid installment", () => {
    const body = buildSplitRequestBody(item(), [
      { date: "2026-10-01", amount: 13431 },
      { date: "2026-11-01", amount: 10000 },
    ]);
    expect(body).toMatchObject({
      source_expense_id: "e1",
      business_domain: "logistics_projects",
      category: "חשבונית מכולה",
      description: "חשבונית מכולה",
      account_id: "acc1",
      payment_method: "bank_transfer",
      project_id: "p1",
      order_id: null,
      property_id: null,
    });
    expect(body.installments).toEqual([
      { expense_date: "2026-09-14", amount: 10000, paid: true },
      { expense_date: "2026-10-01", amount: 13431 },
      { expense_date: "2026-11-01", amount: 10000 },
    ]);
    // Paid part + the new installments add back up to the original bill.
    expect(body.installments.reduce((s, r) => s + r.amount, 0)).toBe(33431);
  });

  it("an unpaid bill splits as is — no paid installment", () => {
    const body = buildSplitRequestBody(item({ amount: 3000, totalAmount: null, paidAmount: null, paymentStatus: "not_paid" }), [
      { date: "2026-10-01", amount: 1500 },
      { date: "2026-11-01", amount: 1500 },
    ]);
    expect(body.installments).toHaveLength(2);
    expect(body.installments.every((r) => !("paid" in r))).toBe(true);
  });

  it("an unknown domain falls back to שוטף", () => {
    expect(buildSplitRequestBody(item({ businessDomain: "nope" }), []).business_domain).toBe("general_business");
  });
});

// A phone's day cell is ~34px wide: "‏168,705 ‏₪" showed as "…65".
describe("compactAmount", () => {
  it("keeps small amounts whole and shortens the rest", () => {
    expect(compactAmount(340)).toBe("340");
    expect(compactAmount(999.4)).toBe("999");
    expect(compactAmount(4_600)).toBe("4.6K");
    expect(compactAmount(9_000)).toBe("9K");
    expect(compactAmount(168_705)).toBe("169K");
    expect(compactAmount(1_250_000)).toBe("1.3M");
    expect(compactAmount(-5_900)).toBe("-5.9K");
  });

  it("keeps the estimate mark and the unknown label", () => {
    expect(dayStageCompactText({ amount: 55_634, variable: true, unknown: false })).toBe("~56K");
    expect(dayStageCompactText({ amount: 0, variable: false, unknown: true })).toBe("משתנה");
    expect(dayStageCompactText({ amount: 0, variable: false, unknown: false })).toBeNull();
  });
});

describe("amountLabel — a bill in US$ / C$", () => {
  const usd = { currency: "USD" as const, amount: 25, rate: 3.1, rateManual: false };
  it("its own currency first, its shekels beside it", () => {
    expect(amountLabel({ amount: 77.5, foreign: usd, variableAmount: false })).toMatch(/^\$25 \(≈ .*78.*₪\)$/);
  });
  it("an estimate reads with ~; no rate yet shows the dollars alone", () => {
    expect(amountLabel({ amount: 77.5, foreign: usd, variableAmount: true })).toMatch(/^~\$25 \(≈/);
    expect(amountLabel({ amount: 0, foreign: { ...usd, rate: 0 }, variableAmount: false })).toBe("$25");
  });
  it("shekels as before", () => {
    expect(amountLabel({ amount: 500, foreign: null, variableAmount: false })).toBe(amountLabel({ amount: 500, variableAmount: false }));
  });
});
