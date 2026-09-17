import { describe, it, expect } from "vitest";
import { itemCapabilities } from "@/app/(app)/financial/payments-calendar/calendar.helpers";
import type { PaymentCalendarItem } from "@/lib/payables";

// What the board lets you DO to a row. This is the one place it decides what a
// row is \u2014 money going out that can be paid, split and sometimes deleted, or
// money coming in that can only be confirmed and corrected \u2014 so it is tested
// directly rather than through the menu that renders it.

function item(over: Partial<PaymentCalendarItem> & { id: string }): PaymentCalendarItem {
  return {
    direction: "out", date: "2026-09-20", amount: 100, label: "x", sourceLabel: "", sourceHref: null,
    stage: "pending", paymentStatus: null, origin: "expense", sourceId: null, domainName: "",
    expenseId: null, category: null, businessDomain: null, accountId: null, paidAmount: null,
    descriptionRaw: null, notes: null, paymentMethod: null, dueDate: "2026-09-20", paidDate: null,
    overdue: false, installmentGroupId: null, installmentIndex: null, installmentCount: null,
    expenseProjectId: null, expenseOrderId: null, expensePropertyId: null, workerUserId: null,
    recurringTemplateId: null, recurrenceKey: null, variableAmount: false, autoPaid: false,
    ...over,
  };
}

const live = new Set(["tpl-live"]);

describe("itemCapabilities \u2014 money going out", () => {
  it("a one-off bill can be paid, split, edited and deleted", () => {
    expect(itemCapabilities(item({ id: "expense:e1", expenseId: "e1" }), live)).toEqual({
      canMark: true, canEdit: true, canSplit: true, canDelete: true, editsTemplateId: null,
    });
  });

  it("a bill from a LIVE recurring rule cannot be deleted \u2014 the generator would recreate it", () => {
    const can = itemCapabilities(item({ id: "expense:e2", expenseId: "e2", recurringTemplateId: "tpl-live" }), live);
    expect(can.canDelete).toBe(false);
    expect(can.canEdit).toBe(true);
  });

  it("an orphan whose template is gone can be deleted \u2014 nothing will bring it back", () => {
    const can = itemCapabilities(item({ id: "expense:e3", expenseId: "e3", recurringTemplateId: "tpl-deleted" }), live);
    expect(can.canDelete).toBe(true);
  });

  it("a forecast has no row: it can be recorded, and \"edit\" means its rule", () => {
    const can = itemCapabilities(item({ id: "recur_proj:tpl-live:2026-10", recurringTemplateId: "tpl-live", recurrenceKey: "2026-10" }), live);
    expect(can).toEqual({ canMark: true, canEdit: true, canSplit: false, canDelete: false, editsTemplateId: "tpl-live" });
  });

  it("a wage or loan forecast offers nothing but a reminder and its own page", () => {
    const can = itemCapabilities(item({ id: "salary_proj:u1:2026-09", origin: "worker_owed" }), live);
    expect(can).toEqual({ canMark: false, canEdit: false, canSplit: false, canDelete: false, editsTemplateId: null });
  });
});

describe("itemCapabilities \u2014 money coming in", () => {
  it("a real payments row can be marked collected and corrected, never split or deleted", () => {
    expect(itemCapabilities(item({ id: "payment:p1", direction: "in", origin: "payment", paymentId: "p1" }), live)).toEqual({
      canMark: true, canEdit: true, canSplit: false, canDelete: false, editsTemplateId: null,
    });
  });

  it("a customer balance has no row yet, so there is nothing to collect or edit", () => {
    // It changes by invoicing or by recording money against it \u2014 not here.
    expect(itemCapabilities(item({ id: "order-receivable:o1", direction: "in", origin: "order_receivable" }), live)).toEqual({
      canMark: false, canEdit: false, canSplit: false, canDelete: false, editsTemplateId: null,
    });
  });
});

describe("itemCapabilities — a card-settlement deposit", () => {
  // Confirmed on the board once the money lands; openable either way to see
  // what it is made of and to undo a confirmation.
  const deposit = (arrived: boolean) =>
    item({
      id: "grow_batch:acc-1:2026-09-10",
      direction: "in",
      settlement: { accountId: "acc-1", date: "2026-09-10", arrived, payments: [] },
    });

  it("can be confirmed while it hasn't arrived", () => {
    expect(itemCapabilities(deposit(false), live)).toMatchObject({ canMark: true, canEdit: true, canSplit: false, canDelete: false });
  });

  it("once confirmed, can only be opened (to see it, or undo)", () => {
    expect(itemCapabilities(deposit(true), live)).toMatchObject({ canMark: false, canEdit: true, canSplit: false, canDelete: false });
  });
});
