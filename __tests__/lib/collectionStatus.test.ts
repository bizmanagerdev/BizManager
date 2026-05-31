import { describe, it, expect } from "vitest";
import {
  splitPaymentAmounts,
  deriveCollectionStatus,
  paymentCollectionChip,
  isCollectedPayment,
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
