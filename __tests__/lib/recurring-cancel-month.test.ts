import { describe, it, expect } from "vitest";
import {
  canCancelRecurringMonth,
  cancelledMonthNote,
  isCancelledRecurringMonth,
  recurrenceKeyLabel,
} from "@/lib/recurring/cancelMonth";

// "ביטול החודש": a cancelled month is its recurring row kept paid at ₪0. These
// are the two questions every screen asks of a row — is it cancelled, can it be.

describe("isCancelledRecurringMonth", () => {
  it("a recurring row paid at ₪0 is a cancelled month", () => {
    expect(isCancelledRecurringMonth({ recurringTemplateId: "t", paymentStatus: "paid", amount: 0 })).toBe(true);
    expect(isCancelledRecurringMonth({ recurringTemplateId: "t", paymentStatus: "paid", amount: "0.00" })).toBe(true);
  });

  it("a real payment, an open month or a one-off ₪0 row is not", () => {
    expect(isCancelledRecurringMonth({ recurringTemplateId: "t", paymentStatus: "paid", amount: 73 })).toBe(false);
    expect(isCancelledRecurringMonth({ recurringTemplateId: "t", paymentStatus: "not_paid", amount: 0 })).toBe(false);
    expect(isCancelledRecurringMonth({ recurringTemplateId: null, paymentStatus: "paid", amount: 0 })).toBe(false);
  });
});

describe("canCancelRecurringMonth", () => {
  it("an open month with nothing paid toward it can be cancelled", () => {
    expect(canCancelRecurringMonth({ recurringTemplateId: "t", paymentStatus: "not_paid", paidAmount: 0 })).toBe(true);
    expect(canCancelRecurringMonth({ recurringTemplateId: "t", paymentStatus: null, paidAmount: null })).toBe(true);
  });

  it("a paid or partly paid month, or a one-off expense, cannot", () => {
    expect(canCancelRecurringMonth({ recurringTemplateId: "t", paymentStatus: "paid", paidAmount: 180 })).toBe(false);
    expect(canCancelRecurringMonth({ recurringTemplateId: "t", paymentStatus: "partial", paidAmount: 50 })).toBe(false);
    expect(canCancelRecurringMonth({ recurringTemplateId: null, paymentStatus: "not_paid", paidAmount: 0 })).toBe(false);
  });
});

describe("cancelledMonthNote / recurrenceKeyLabel", () => {
  it("says why, with a default, and keeps an earlier note", () => {
    expect(cancelledMonthNote("")).toBe("בוטל – לא היה חיוב החודש");
    expect(cancelledMonthNote("הוקפא", "ישן")).toBe("בוטל – הוקפא\nישן");
  });

  it("names the month in Hebrew", () => {
    expect(recurrenceKeyLabel("2026-08")).toBe("אוגוסט 2026");
    expect(recurrenceKeyLabel("2027")).toBe("2027");
  });
});
