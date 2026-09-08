import { describe, it, expect } from "vitest";
import {
  splitPaymentAmounts,
  deriveCollectionStatus,
  paymentCollectionChip,
  isCollectedPayment,
  normalizePaymentMethodValue,
  toNumber,
  normalizePaymentEntries,
  hasInvalidPaymentEntry,
  sumPayments,
  derivePaymentStatus,
  paymentStatusLabel,
  paymentMethodLabel,
  collectionStatusLabel,
  orderCollectionStatusLabel,
  validateRequestedPaymentStatus,
} from "@/lib/orders/paymentStatus";

const TODAY = new Date("2026-05-31");

describe("splitPaymentAmounts", () => {
  it("counts cleared and legacy (null status) money as collected", () => {
    const split = splitPaymentAmounts(
      [
        { amount_total: 100, payment_status: "cleared" },
        { amount_total: 50, payment_status: null },
      ],
      TODAY
    );
    expect(split.collected).toBe(150);
    expect(split.pending).toBe(0);
  });

  it("counts pending money as expected, not collected", () => {
    const split = splitPaymentAmounts(
      [{ amount_total: 200, payment_status: "pending", due_date: "2026-06-30" }],
      TODAY
    );
    expect(split.collected).toBe(0);
    expect(split.pending).toBe(200);
    expect(split.overdue).toBe(0);
  });

  it("flags pending money whose due_date has passed as overdue", () => {
    const split = splitPaymentAmounts(
      [{ amount_total: 200, payment_status: "pending", due_date: "2026-05-01" }],
      TODAY
    );
    expect(split.pending).toBe(200);
    expect(split.overdue).toBe(200);
  });

  it("ignores rejected (bounced) payments entirely", () => {
    const split = splitPaymentAmounts(
      [{ amount_total: 200, payment_status: "rejected" }],
      TODAY
    );
    expect(split.collected).toBe(0);
    expect(split.pending).toBe(0);
  });

  it("treats due_date == today as overdue (money should be in by now)", () => {
    const split = splitPaymentAmounts(
      [{ amount_total: 80, payment_status: "pending", due_date: "2026-05-31" }],
      TODAY
    );
    expect(split.overdue).toBe(80);
  });
});

describe("deriveCollectionStatus", () => {
  it("collected when collected covers the total", () => {
    expect(
      deriveCollectionStatus({ totalAmount: 100, collected: 100, pending: 0, overdue: 0 })
    ).toBe("collected");
  });

  it("overdue takes priority when expected money is past due", () => {
    expect(
      deriveCollectionStatus({ totalAmount: 100, collected: 0, pending: 100, overdue: 100 })
    ).toBe("overdue");
  });

  it("awaiting when expected money is still future-dated", () => {
    expect(
      deriveCollectionStatus({ totalAmount: 100, collected: 0, pending: 100, overdue: 0 })
    ).toBe("awaiting");
  });

  it("partial when some collected and remainder not scheduled", () => {
    expect(
      deriveCollectionStatus({ totalAmount: 100, collected: 40, pending: 0, overdue: 0 })
    ).toBe("partial");
  });

  it("unpaid when nothing collected and nothing expected", () => {
    expect(
      deriveCollectionStatus({ totalAmount: 100, collected: 0, pending: 0, overdue: 0 })
    ).toBe("unpaid");
  });
});

describe("paymentCollectionChip", () => {
  it("returns no chip for cleared money", () => {
    expect(paymentCollectionChip({ payment_status: "cleared" }, TODAY)).toBeNull();
  });

  it("returns צפוי for future-dated pending money", () => {
    expect(
      paymentCollectionChip({ payment_status: "pending", due_date: "2026-06-30" }, TODAY)?.label
    ).toBe("צפוי");
  });

  it("returns באיחור for pending money past its due_date", () => {
    expect(
      paymentCollectionChip({ payment_status: "pending", due_date: "2026-05-01" }, TODAY)?.label
    ).toBe("באיחור");
  });
});

describe("isCollectedPayment", () => {
  it("null/legacy and cleared count as collected", () => {
    expect(isCollectedPayment(null)).toBe(true);
    expect(isCollectedPayment("cleared")).toBe(true);
  });
  it("pending and rejected do not count as collected", () => {
    expect(isCollectedPayment("pending")).toBe(false);
    expect(isCollectedPayment("rejected")).toBe(false);
  });
});

describe("paymentCollectionChip — rejected", () => {
  it("shows נדחה regardless of due_date", () => {
    expect(paymentCollectionChip({ payment_status: "rejected", due_date: "2020-01-01" })?.label).toBe(
      "נדחה"
    );
  });
});

describe("normalizePaymentMethodValue", () => {
  it("normalizes English codes, spaced variants, and Hebrew free text to one canonical code", () => {
    expect(normalizePaymentMethodValue("cash")).toBe("cash");
    expect(normalizePaymentMethodValue("מזומן")).toBe("cash");
    expect(normalizePaymentMethodValue("bank transfer")).toBe("bank_transfer");
    expect(normalizePaymentMethodValue("העברה בנקאית")).toBe("bank_transfer");
    expect(normalizePaymentMethodValue("Credit Card")).toBe("credit_card");
    expect(normalizePaymentMethodValue("אשראי")).toBe("credit_card");
    expect(normalizePaymentMethodValue("cheque")).toBe("check");
    expect(normalizePaymentMethodValue("ביט")).toBe("bit");
  });
  it("passes unrecognized text through unchanged, and blanks empty/null", () => {
    expect(normalizePaymentMethodValue("some custom method")).toBe("some custom method");
    expect(normalizePaymentMethodValue(null)).toBe("");
    expect(normalizePaymentMethodValue(undefined)).toBe("");
    expect(normalizePaymentMethodValue("   ")).toBe("");
  });
});

describe("toNumber", () => {
  it("parses finite numbers and numeric strings", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber("42.5")).toBe(42.5);
  });
  it("is NaN for non-finite/non-numeric input", () => {
    expect(Number.isNaN(toNumber("not a number"))).toBe(true);
    expect(Number.isNaN(toNumber(Infinity))).toBe(true);
    expect(Number.isNaN(toNumber(null))).toBe(true);
    expect(Number.isNaN(toNumber(undefined))).toBe(true);
  });
});

describe("normalizePaymentEntries / hasInvalidPaymentEntry", () => {
  it("trims strings, coerces amounts, and blanks unset optional fields", () => {
    const [entry] = normalizePaymentEntries([
      { amount_total: "150", payment_date: "2026-06-01", payment_method: " cash ", notes: "  hi  " },
    ]);
    expect(entry).toMatchObject({
      amount_total: 150,
      payment_date: "2026-06-01",
      payment_method: "cash",
      account_id: null,
      notes: "hi",
    });
  });
  it("treats a missing/non-array input as no entries", () => {
    expect(normalizePaymentEntries(undefined)).toEqual([]);
  });

  it("flags an entry with a non-positive amount, missing date, or missing method as invalid", () => {
    const [valid] = normalizePaymentEntries([
      { amount_total: 100, payment_date: "2026-06-01", payment_method: "cash" },
    ]);
    expect(hasInvalidPaymentEntry([valid])).toBe(false);

    const [zeroAmount] = normalizePaymentEntries([
      { amount_total: 0, payment_date: "2026-06-01", payment_method: "cash" },
    ]);
    expect(hasInvalidPaymentEntry([zeroAmount])).toBe(true);

    const [noDate] = normalizePaymentEntries([{ amount_total: 100, payment_method: "cash" }]);
    expect(hasInvalidPaymentEntry([noDate])).toBe(true);

    const [noMethod] = normalizePaymentEntries([{ amount_total: 100, payment_date: "2026-06-01" }]);
    expect(hasInvalidPaymentEntry([noMethod])).toBe(true);
  });
});

describe("sumPayments", () => {
  it("adds up valid amounts and ignores unparseable ones", () => {
    expect(sumPayments([{ amount_total: 100 }, { amount_total: "50" }, { amount_total: "oops" }])).toBe(
      150
    );
  });
  it("is 0 for an empty/unset list", () => {
    expect(sumPayments([])).toBe(0);
    expect(sumPayments(undefined)).toBe(0);
  });
});

describe("derivePaymentStatus", () => {
  it("unpaid when nothing has been paid", () => {
    expect(derivePaymentStatus(100, 0)).toBe("unpaid");
  });
  it("partial when some but not the full amount has been paid", () => {
    expect(derivePaymentStatus(100, 40)).toBe("partial");
  });
  it("paid once the paid amount reaches the total (within rounding tolerance)", () => {
    expect(derivePaymentStatus(100, 100)).toBe("paid");
    expect(derivePaymentStatus(100, 100.005)).toBe("paid"); // floating-point tolerance
  });
});

describe("paymentStatusLabel / paymentMethodLabel", () => {
  it("labels every payment status, defaulting unknowns to לא שולם", () => {
    expect(paymentStatusLabel("paid")).toBe("שולם");
    expect(paymentStatusLabel("partial")).toBe("שולם חלקית");
    expect(paymentStatusLabel("unpaid")).toBe("לא שולם");
    expect(paymentStatusLabel("weird")).toBe("לא שולם");
  });
  it("labels every known payment method in Hebrew", () => {
    expect(paymentMethodLabel("cash")).toBe("מזומן");
    expect(paymentMethodLabel("bank_transfer")).toBe("העברה בנקאית");
    expect(paymentMethodLabel("check")).toBe("צ'ק");
    expect(paymentMethodLabel(null)).toBe("-");
  });
});

describe("collectionStatusLabel / orderCollectionStatusLabel", () => {
  it("labels every collection status", () => {
    expect(collectionStatusLabel("overpaid")).toBe("שולם יתר");
    expect(collectionStatusLabel("collected")).toBe("שולם");
    expect(collectionStatusLabel("awaiting")).toBe("תשלום צפוי");
    expect(collectionStatusLabel("overdue")).toBe("באיחור");
    expect(collectionStatusLabel("unpaid")).toBe("לא שולם");
  });
  it("orderCollectionStatusLabel is the same wording as collectionStatusLabel", () => {
    expect(orderCollectionStatusLabel("awaiting")).toBe(collectionStatusLabel("awaiting"));
  });
});

describe("deriveCollectionStatus — the full precedence order", () => {
  it("overpaid beats collected when more than the total came in", () => {
    expect(deriveCollectionStatus({ totalAmount: 100, collected: 150, pending: 0, overdue: 0 })).toBe(
      "overpaid"
    );
  });
  it("overdue beats awaiting when some expected money is both overdue AND future-pending", () => {
    expect(deriveCollectionStatus({ totalAmount: 100, collected: 0, pending: 20, overdue: 30 })).toBe(
      "overdue"
    );
  });
  it("partial when something was collected but the rest isn't scheduled at all", () => {
    expect(deriveCollectionStatus({ totalAmount: 100, collected: 40, pending: 0, overdue: 0 })).toBe(
      "partial"
    );
  });
  it("unpaid when nothing at all is collected, pending, or overdue", () => {
    expect(deriveCollectionStatus({ totalAmount: 100, collected: 0, pending: 0, overdue: 0 })).toBe(
      "unpaid"
    );
  });
});

describe("validateRequestedPaymentStatus", () => {
  it("rejects marking an order 'paid' without a matching full payment", () => {
    expect(
      validateRequestedPaymentStatus({ requestedStatus: "paid", totalAmount: 100, paidAmount: 40 })
    ).not.toBeNull();
  });
  it("accepts 'paid' once the paid amount covers the total", () => {
    expect(
      validateRequestedPaymentStatus({ requestedStatus: "paid", totalAmount: 100, paidAmount: 100 })
    ).toBeNull();
  });
  it("rejects 'partial' with nothing paid, or with the FULL amount paid", () => {
    expect(
      validateRequestedPaymentStatus({ requestedStatus: "partial", totalAmount: 100, paidAmount: 0 })
    ).not.toBeNull();
    expect(
      validateRequestedPaymentStatus({ requestedStatus: "partial", totalAmount: 100, paidAmount: 100 })
    ).not.toBeNull();
  });
  it("rejects 'unpaid' when payments already exist", () => {
    expect(
      validateRequestedPaymentStatus({ requestedStatus: "unpaid", totalAmount: 100, paidAmount: 10 })
    ).not.toBeNull();
  });
  it("an unrecognized status is not validated here (returns null)", () => {
    expect(
      validateRequestedPaymentStatus({ requestedStatus: "whatever", totalAmount: 100, paidAmount: 10 })
    ).toBeNull();
  });
});
