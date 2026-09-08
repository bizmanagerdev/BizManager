import { describe, it, expect } from "vitest";
import { applyProjectVatToBase, projectVatPortionOfBase } from "@/lib/projects/vat";

describe("applyProjectVatToBase", () => {
  it("returns the base unchanged for a default (net-priced) project", () => {
    expect(applyProjectVatToBase(1000, { priceIncludesVat: false })).toBe(1000);
    expect(applyProjectVatToBase(1000, {})).toBe(1000);
  });
  it("grosses the base up by the project's frozen VAT rate when price-includes-VAT", () => {
    expect(applyProjectVatToBase(1000, { priceIncludesVat: true, vatRate: 0.18 })).toBe(1180);
  });
  it("falls back to the app default VAT rate when the project has none set", () => {
    expect(applyProjectVatToBase(1000, { priceIncludesVat: true })).toBe(1180); // DEFAULT_VAT_RATE = 0.18
  });
  it("passes a non-finite / zero base straight through", () => {
    expect(applyProjectVatToBase(0, { priceIncludesVat: true, vatRate: 0.18 })).toBe(0);
    expect(applyProjectVatToBase(NaN, { priceIncludesVat: true, vatRate: 0.18 })).toBeNaN();
  });
});

describe("projectVatPortionOfBase", () => {
  it("is 0 for a net-priced project (nothing baked in)", () => {
    expect(projectVatPortionOfBase(1000, { priceIncludesVat: false })).toBe(0);
  });
  it("is exactly the VAT amount added on top of the base", () => {
    expect(projectVatPortionOfBase(1000, { priceIncludesVat: true, vatRate: 0.18 })).toBe(180);
  });
});
