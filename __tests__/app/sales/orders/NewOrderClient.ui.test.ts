import { describe, expect, it } from "vitest";
import {
  extractCityFromAddress,
  formatCurrency,
  getNumber,
  getString,
  mapCustomerSearchResult,
  termsLabel,
  toNonNegativeInt,
  toPositiveInt,
} from "@/app/(app)/sales/orders/new/NewOrderClient.ui";

// Pure helpers lifted out of NewOrderClient (the order wizard) — no JSX here,
// so this runs on the default "node" environment, no jsdom needed.
describe("getString", () => {
  it("returns the first key with a non-empty trimmed string value", () => {
    expect(getString({ a: "  ", b: " hi " }, ["a", "b"])).toBe("hi");
  });

  it("returns null when nothing matches", () => {
    expect(getString({ a: 5, b: null }, ["a", "b", "c"])).toBeNull();
  });
});

describe("getNumber", () => {
  it("accepts a finite number or a numeric string, in key order", () => {
    expect(getNumber({ a: "not a number", b: "12.5" }, ["a", "b"])).toBe(12.5);
    expect(getNumber({ a: 3 }, ["a", "b"])).toBe(3);
  });

  it("returns null when nothing parses", () => {
    expect(getNumber({ a: "abc", b: NaN }, ["a", "b"])).toBeNull();
  });
});

describe("toPositiveInt / toNonNegativeInt", () => {
  it("clamps to a minimum of 1 / 0 respectively, and rounds", () => {
    expect(toPositiveInt(0.4)).toBe(1);
    expect(toPositiveInt(-5)).toBe(1);
    expect(toPositiveInt(3.6)).toBe(4);
    expect(toNonNegativeInt(-5)).toBe(0);
    expect(toNonNegativeInt(2.4)).toBe(2);
  });

  it("falls back to the floor value for a non-finite input", () => {
    expect(toPositiveInt(NaN)).toBe(1);
    expect(toNonNegativeInt(Infinity)).toBe(0);
  });
});

describe("formatCurrency", () => {
  it("formats as he-IL ILS with no fixed decimals", () => {
    expect(formatCurrency(1500)).toContain("1,500");
    expect(formatCurrency(1500)).toContain("₪");
  });
});

describe("extractCityFromAddress", () => {
  it("takes the part before the first '|' separator", () => {
    expect(extractCityFromAddress("תל אביב|רחוב הרצל 1")).toBe("תל אביב");
  });

  it("returns the whole trimmed address when there's no separator", () => {
    expect(extractCityFromAddress("  רחוב הרצל 1  ")).toBe("רחוב הרצל 1");
  });

  it("returns null for empty/null input", () => {
    expect(extractCityFromAddress(null)).toBeNull();
    expect(extractCityFromAddress("   ")).toBeNull();
  });
});

describe("mapCustomerSearchResult", () => {
  it("returns null when the row has no id", () => {
    expect(mapCustomerSearchResult({ name: "דוד" })).toBeNull();
  });

  it("maps a full row, deriving city from the address and defaulting a blank name", () => {
    const result = mapCustomerSearchResult({
      id: "c1",
      name: "  ",
      address: "תל אביב|הרצל 1",
      requires_prepayment: true,
    });
    expect(result).toMatchObject({
      id: "c1",
      name: "לקוח", // blank name falls back to the generic label
      city: "תל אביב",
      address: "תל אביב|הרצל 1",
      requiresPrepayment: true,
    });
  });

  it("treats the 'unknown place' sentinel as no address/city", () => {
    const result = mapCustomerSearchResult({ id: "c1", name: "דוד", address: "לא ידוע" });
    expect(result?.address).toBeNull();
    expect(result?.city).toBeNull();
  });

  it("maps nested contacts and branches defensively, dropping a branch with no id", () => {
    const result = mapCustomerSearchResult({
      id: "c1",
      name: "דוד",
      contacts: [{ full_name: "שרה", phone: "050", email: null }],
      branches: [
        { id: "b1", name: "סניף מרכז" },
        { id: "", name: "סניף בלי מזהה" },
      ],
    });
    expect(result?.contacts).toEqual([{ full_name: "שרה", phone: "050", email: null }]);
    expect(result?.branches).toEqual([{ id: "b1", name: "סניף מרכז", address: null, phone: null }]);
  });
});

describe("termsLabel", () => {
  it("maps a known payment-terms value to its Hebrew label", () => {
    expect(termsLabel("eom_30")).toBe("שוטף+30");
  });

  it("falls back to the raw value for an unrecognized one", () => {
    expect(termsLabel("something_else")).toBe("something_else");
  });
});
