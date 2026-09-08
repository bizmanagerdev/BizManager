import { describe, it, expect } from "vitest";
import { isUnpaidPrepayment } from "@/lib/orders/prepayment";

describe("isUnpaidPrepayment", () => {
  it("flags a pay-ahead customer's order with money still owed", () => {
    expect(isUnpaidPrepayment(true, 100)).toBe(true);
  });
  it("does not flag a pay-ahead customer's order once it's fully paid (within rounding tolerance)", () => {
    expect(isUnpaidPrepayment(true, 0)).toBe(false);
    expect(isUnpaidPrepayment(true, 0.005)).toBe(false);
  });
  it("never flags a customer who isn't marked pay-ahead, regardless of balance", () => {
    expect(isUnpaidPrepayment(false, 500)).toBe(false);
  });
});
