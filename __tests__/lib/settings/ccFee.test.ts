import { describe, it, expect } from "vitest";
import { normalizeCcFeeRate, DEFAULT_CC_FEE_RATE } from "@/lib/settings/ccFee";

describe("normalizeCcFeeRate", () => {
  it("passes a fraction through unchanged", () => {
    expect(normalizeCcFeeRate(0.14)).toBe(0.14);
  });
  it("tolerates a percentage and converts it to a fraction", () => {
    expect(normalizeCcFeeRate(14)).toBe(0.14);
  });
  it("accepts a numeric string in either form", () => {
    expect(normalizeCcFeeRate("0.12")).toBe(0.12);
    expect(normalizeCcFeeRate("12")).toBe(0.12);
  });
  it("rounds to 4 decimal places", () => {
    expect(normalizeCcFeeRate(0.141234)).toBe(0.1412);
  });
  it("falls back to the default for negative, non-numeric, or nonsensically large input", () => {
    expect(normalizeCcFeeRate(-1)).toBe(DEFAULT_CC_FEE_RATE);
    expect(normalizeCcFeeRate("garbage")).toBe(DEFAULT_CC_FEE_RATE);
    expect(normalizeCcFeeRate(null)).toBe(DEFAULT_CC_FEE_RATE);
    expect(normalizeCcFeeRate(undefined)).toBe(DEFAULT_CC_FEE_RATE);
    expect(normalizeCcFeeRate(150)).toBe(DEFAULT_CC_FEE_RATE);
  });
  it("0 is a valid rate (no fee), not treated as unset", () => {
    expect(normalizeCcFeeRate(0)).toBe(0);
  });
});
