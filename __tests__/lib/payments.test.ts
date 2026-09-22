import { describe, it, expect } from "vitest";
import { addMonthsIso, buildPaymentInsert, nextMonthTenth, parseInstallments, splitCardInstallments } from "@/lib/payments";
import { splitPaymentAmounts } from "@/lib/orders/paymentStatus";
import { applyProjectVatToBase, baseFromPriceEntry, projectPriceSplit } from "@/lib/projects/vat";

const BASE_INPUT = {
  paymentDate: "2024-06-01",
  amountTotal: 1180,
  paymentMethod: "bank_transfer",
  businessDomain: "general_business" as const,
  recordedBy: "user-1",
};

describe("buildPaymentInsert — VAT split (18%)", () => {
  it("does NOT split VAT when requiresSplit is false/omitted", () => {
    const result = buildPaymentInsert({ ...BASE_INPUT });
    expect(result.requires_split).toBe(false);
    expect(result.amount_before_vat).toBeNull();
    expect(result.amount_including_vat).toBeNull();
    expect(result.net_amount).toBe(1180);
  });

  it("splits VAT when requiresSplit is true", () => {
    const result = buildPaymentInsert({ ...BASE_INPUT, requiresSplit: true });
    expect(result.requires_split).toBe(true);
    // 1180 / 1.18 = 1000 before VAT
    expect(result.amount_before_vat).toBe(1000);
    expect(result.amount_including_vat).toBe(1180);
    expect(result.net_amount).toBe(1000); // net = before VAT
    expect(result.vat_amount).toBe(180); // arrived − counted
    expect(result.vat_rate).toBe(0.18);
  });

  it("non-official payment has vat_amount 0 and vat_rate 0", () => {
    const result = buildPaymentInsert({ ...BASE_INPUT });
    expect(result.vat_amount).toBe(0);
    expect(result.vat_rate).toBe(0);
  });

  it("uses the supplied VAT rate and freezes it on the row", () => {
    // 17% era: 1170 / 1.17 = 1000 net, 170 VAT.
    const result = buildPaymentInsert({ ...BASE_INPUT, amountTotal: 1170, requiresSplit: true, vatRate: 0.17 });
    expect(result.amount_before_vat).toBe(1000);
    expect(result.net_amount).toBe(1000);
    expect(result.vat_amount).toBe(170);
    expect(result.vat_rate).toBe(0.17);
  });

  it("arrived = counted + VAT always holds", () => {
    const result = buildPaymentInsert({ ...BASE_INPUT, amountTotal: 100, requiresSplit: true });
    expect(
      Math.round(((result.net_amount as number) + (result.vat_amount as number)) * 100) / 100
    ).toBe(result.amount_total);
  });

  it("vatRate is ignored for non-official payments", () => {
    const result = buildPaymentInsert({ ...BASE_INPUT, requiresSplit: false, vatRate: 0.17 });
    expect(result.net_amount).toBe(1180);
    expect(result.vat_rate).toBe(0);
  });

  it("rounds VAT split amounts to 2 decimal places", () => {
    const result = buildPaymentInsert({ ...BASE_INPUT, amountTotal: 100, requiresSplit: true });
    // 100 / 1.18 = 84.7457... → 84.75
    expect(result.amount_before_vat).toBe(84.75);
    expect(result.amount_total).toBe(100);
  });
});

describe("buildPaymentInsert — check payment defaults", () => {
  it("status=pending for check when not explicitly set", () => {
    const result = buildPaymentInsert({ ...BASE_INPUT, paymentMethod: "check" });
    expect(result.payment_status).toBe("pending");
  });

  it("copies paymentDate to due_date for checks when no dueDate given", () => {
    const result = buildPaymentInsert({ ...BASE_INPUT, paymentMethod: "check" });
    expect(result.due_date).toBe("2024-06-01");
  });

  it("uses explicit dueDate for checks when provided", () => {
    const result = buildPaymentInsert({ ...BASE_INPUT, paymentMethod: "check", dueDate: "2024-09-01" });
    expect(result.due_date).toBe("2024-09-01");
  });

  it("status=cleared for non-check payments when not explicitly set", () => {
    const result = buildPaymentInsert({ ...BASE_INPUT, paymentMethod: "cash" });
    expect(result.payment_status).toBe("cleared");
  });

  it("due_date is null for non-check payments when not explicitly set", () => {
    const result = buildPaymentInsert({ ...BASE_INPUT, paymentMethod: "cash" });
    expect(result.due_date).toBeNull();
  });

  it("respects explicit paymentStatus override", () => {
    const result = buildPaymentInsert({ ...BASE_INPUT, paymentMethod: "check", paymentStatus: "cleared" });
    expect(result.payment_status).toBe("cleared");
  });
});

describe("buildPaymentInsert — future due_date (bank transfer)", () => {
  it("status=pending for bank transfer with a future due_date", () => {
    const result = buildPaymentInsert({ ...BASE_INPUT, dueDate: "2099-01-01" });
    expect(result.payment_status).toBe("pending");
  });

  it("status=pending when paymentDate == dueDate and both are in the future", () => {
    // Regression: equal dates used to bypass the pending check, causing the order to
    // appear fully paid even though the money wasn't due yet.
    const result = buildPaymentInsert({ ...BASE_INPUT, paymentDate: "2099-01-01", dueDate: "2099-01-01" });
    expect(result.payment_status).toBe("pending");
  });

  it("status=cleared for bank transfer with a past due_date", () => {
    const result = buildPaymentInsert({ ...BASE_INPUT, dueDate: "2020-01-01" });
    expect(result.payment_status).toBe("cleared");
  });
});

describe("buildPaymentInsert — credit_card is always cleared, regardless of due_date", () => {
  // A card charge is collected from the customer immediately — a future due_date
  // on a credit_card payment (e.g. a processor's monthly settlement day) must NOT
  // make the order/customer side look unpaid. Only the account ledger defers to it.
  it("status=cleared for credit_card with a far-future due_date", () => {
    const result = buildPaymentInsert({ ...BASE_INPUT, paymentMethod: "credit_card", dueDate: "2099-01-01" });
    expect(result.payment_status).toBe("cleared");
    expect(result.due_date).toBe("2099-01-01");
  });

  it("status=cleared for credit_card with no due_date at all", () => {
    const result = buildPaymentInsert({ ...BASE_INPUT, paymentMethod: "credit_card" });
    expect(result.payment_status).toBe("cleared");
  });

  it("an explicit paymentStatus override still wins for credit_card", () => {
    const result = buildPaymentInsert({
      ...BASE_INPUT,
      paymentMethod: "credit_card",
      dueDate: "2099-01-01",
      paymentStatus: "pending",
    });
    expect(result.payment_status).toBe("pending");
  });
});

describe("splitPaymentAmounts — counts toward price uses net_amount", () => {
  it("official payment counts only the net (VAT excluded)", () => {
    const split = splitPaymentAmounts([
      { amount_total: 118, net_amount: 100, payment_status: "cleared" },
    ]);
    expect(split.collected).toBe(100);
  });

  it("non-official payment counts in full", () => {
    const split = splitPaymentAmounts([
      { amount_total: 100, net_amount: 100, payment_status: "cleared" },
    ]);
    expect(split.collected).toBe(100);
  });

  it("falls back to gross when net_amount is missing (legacy rows)", () => {
    const split = splitPaymentAmounts([
      { amount_total: 100, net_amount: null, payment_status: "cleared" },
    ]);
    expect(split.collected).toBe(100);
  });

  it("mixed official + cash net out to the agreed price, not the gross received", () => {
    // 1,000,000 project: 500,000 net via official (590,000 arrived) + 540,000 cash.
    const split = splitPaymentAmounts([
      { amount_total: 590000, net_amount: 500000, payment_status: "cleared" },
      { amount_total: 540000, net_amount: 540000, payment_status: "cleared" },
    ]);
    expect(split.collected).toBe(1040000); // counts toward price (not 1,130,000 gross)
  });
});

describe("nextMonthTenth — credit-card processor settlement day", () => {
  it("returns the 10th of the following month", () => {
    expect(nextMonthTenth("2026-08-05")).toBe("2026-09-10");
  });

  it("rolls over the year in December", () => {
    expect(nextMonthTenth("2026-12-25")).toBe("2027-01-10");
  });

  it("returns '' for a malformed date", () => {
    expect(nextMonthTenth("not-a-date")).toBe("");
    expect(nextMonthTenth("")).toBe("");
  });
});

describe("splitCardInstallments — a card payment in installments, as the payments it is entered as", () => {
  it("₪1,000 in 3: shares that add up exactly, a month apart, each landing on the next month's 10th", () => {
    const parts = splitCardInstallments({ amount: 1000, paymentDate: "2026-09-17", count: 3, notes: "הזמנה 12" });
    expect(parts.map((p) => p.amount)).toEqual([333.34, 333.33, 333.33]);
    expect(parts.reduce((sum, p) => sum + p.amount, 0)).toBeCloseTo(1000, 2);
    expect(parts.map((p) => p.paymentDate)).toEqual(["2026-09-17", "2026-10-17", "2026-11-17"]);
    expect(parts.map((p) => p.dueDate)).toEqual(["2026-10-10", "2026-11-10", "2026-12-10"]);
    expect(parts.map((p) => p.notes)).toEqual(["הזמנה 12 · תשלום 1/3", "הזמנה 12 · תשלום 2/3", "הזמנה 12 · תשלום 3/3"]);
  });

  it("one installment is just the payment, with no label", () => {
    const [only, ...rest] = splitCardInstallments({ amount: 500, paymentDate: "2026-09-17", count: 1, notes: "" });
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ amount: 500, paymentDate: "2026-09-17", dueDate: "2026-10-10", notes: null });
  });

  it("keeps the day in short months and crosses the year", () => {
    const parts = splitCardInstallments({ amount: 300, paymentDate: "2026-12-31", count: 3 });
    expect(parts.map((p) => p.paymentDate)).toEqual(["2026-12-31", "2027-01-31", "2027-02-28"]);
    expect(parts.map((p) => p.dueDate)).toEqual(["2027-01-10", "2027-02-10", "2027-03-10"]);
  });
});

describe("parseInstallments / addMonthsIso", () => {
  it("accepts whole numbers 1..36 only", () => {
    expect(parseInstallments("3")).toBe(3);
    expect(parseInstallments(" 12 ")).toBe(12);
    expect(parseInstallments("0")).toBeNull();
    expect(parseInstallments("37")).toBeNull();
    expect(parseInstallments("2.5")).toBeNull();
    expect(parseInstallments("")).toBeNull();
  });

  it("moves by whole months", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-11-15", 2)).toBe("2027-01-15");
    expect(addMonthsIso("nope", 1)).toBe("");
  });
});

describe("applyProjectVatToBase — Phase 2 gross target", () => {
  it("returns the base unchanged for net-priced projects", () => {
    expect(applyProjectVatToBase(30000, { priceIncludesVat: false })).toBe(30000);
  });

  it("grosses up the base for price-includes-VAT projects", () => {
    expect(applyProjectVatToBase(30000, { priceIncludesVat: true, vatRate: 0.18 })).toBe(35400);
  });

  it("uses the frozen project rate when provided", () => {
    expect(applyProjectVatToBase(1000, { priceIncludesVat: true, vatRate: 0.17 })).toBe(1170);
  });
});

describe("baseFromPriceEntry / projectPriceSplit — typing the price with or without VAT", () => {
  it("keeps a price typed as the base, and divides one typed as the full sum", () => {
    expect(baseFromPriceEntry(30000, "base", 0.18)).toBe(30000);
    // ₪35,400 the customer pays → ₪30,000 base.
    expect(baseFromPriceEntry(35400, "gross", 0.18)).toBe(30000);
    // Not a round number: kept to the agora.
    expect(baseFromPriceEntry(1000, "gross", 0.18)).toBe(847.46);
  });

  it("uses the project's own rate, and is safe on an empty price", () => {
    expect(baseFromPriceEntry(1170, "gross", 0.17)).toBe(1000);
    expect(baseFromPriceEntry(0, "gross", 0.18)).toBe(0);
    expect(baseFromPriceEntry(Number.NaN, "gross", 0.18)).toBe(0);
  });

  it("shows base + VAT = the full sum", () => {
    expect(projectPriceSplit(30000, 0.18)).toEqual({ base: 30000, vat: 5400, gross: 35400 });
    // The agora a division leaves over stays inside the VAT part.
    expect(projectPriceSplit(847.46, 0.18)).toEqual({ base: 847.46, vat: 152.54, gross: 1000 });
  });
});

