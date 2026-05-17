import { describe, it, expect } from "vitest";
import { buildPaymentInsert } from "@/lib/payments";

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
