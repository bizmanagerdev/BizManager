import { describe, it, expect } from "vitest";
import { buildSplitRequestBody, partialPaidNote } from "@/app/(app)/financial/payments-calendar/calendar.helpers";
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
