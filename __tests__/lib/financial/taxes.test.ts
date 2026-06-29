import { describe, it, expect } from "vitest";
import { carveVatFromGross } from "@/lib/financial/taxes";

describe("carveVatFromGross — VAT carved out of a VAT-inclusive amount", () => {
  it("carves 18% out of a gross sales total", () => {
    // 118 includes 18 of VAT (the 100 price + 18 tax).
    expect(carveVatFromGross(118, 0.18)).toBeCloseTo(18, 6);
  });

  it("carves proportionally for any amount", () => {
    expect(carveVatFromGross(1180, 0.18)).toBeCloseTo(180, 6);
    expect(carveVatFromGross(59, 0.18)).toBeCloseTo(9, 6); // the 59 in the worked example
  });

  it("returns 0 for a zero/invalid rate (no VAT to carve)", () => {
    expect(carveVatFromGross(100, 0)).toBe(0);
    expect(carveVatFromGross(100, NaN)).toBe(0);
  });

  it("a refund (negative gross) carves a negative slice → reduces VAT owed", () => {
    expect(carveVatFromGross(-118, 0.18)).toBeCloseTo(-18, 6);
  });
});
