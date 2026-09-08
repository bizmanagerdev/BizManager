import { describe, it, expect } from "vitest";
import { normalizeVatRate, DEFAULT_VAT_RATE } from "@/lib/settings/vat";

describe("normalizeVatRate", () => {
  it("passes a fraction through unchanged", () => {
    expect(normalizeVatRate(0.18)).toBe(0.18);
  });
  it("tolerates a percentage and converts it to a fraction", () => {
    expect(normalizeVatRate(18)).toBe(0.18);
  });
  it("accepts a numeric string in either form", () => {
    expect(normalizeVatRate("0.17")).toBe(0.17);
    expect(normalizeVatRate("17")).toBe(0.17);
  });
  it("rounds to 4 decimal places", () => {
    expect(normalizeVatRate(0.181234)).toBe(0.1812);
  });
  it("falls back to the default for negative, non-numeric, or nonsensically large input", () => {
    expect(normalizeVatRate(-5)).toBe(DEFAULT_VAT_RATE);
    expect(normalizeVatRate("not a number")).toBe(DEFAULT_VAT_RATE);
    expect(normalizeVatRate(null)).toBe(DEFAULT_VAT_RATE);
    expect(normalizeVatRate(undefined)).toBe(DEFAULT_VAT_RATE);
    // > 100 as a percentage still lands > 1 as a fraction — out of range either way.
    expect(normalizeVatRate(150)).toBe(DEFAULT_VAT_RATE);
  });
  it("0 is a valid rate (VAT-exempt), not treated as unset", () => {
    expect(normalizeVatRate(0)).toBe(0);
  });
});
