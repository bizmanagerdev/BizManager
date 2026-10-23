import { describe, expect, it } from "vitest";
import { foreignShare, readForeignMoney } from "@/lib/fx/currencies";
import { formatCurrencyAmount, formatMoneyWithForeign, formatShekelNote } from "@/lib/money";

// A money row in US$ or C$ keeps its shekels in its usual column, and beside
// it the amount as typed and its day's rate (owner's plan, 2026-10-23:
// "$1,000 (≈ ₪3,107)", every total in shekels).

describe("readForeignMoney", () => {
  it("reads a row in dollars, as the server sends it", () => {
    expect(readForeignMoney({ currency: "USD", foreign_amount: "1000.00", fx_rate: "3.107000", fx_rate_manual: false })).toEqual({
      currency: "USD",
      amount: 1000,
      rate: 3.107,
      rateManual: false,
    });
  });

  it("reads the phone's copy too: numbers as text, the typed-rate flag as 1", () => {
    expect(readForeignMoney({ currency: "CAD", foreign_amount: "500", fx_rate: "2.2137", fx_rate_manual: 1 })).toMatchObject({
      currency: "CAD",
      amount: 500,
      rateManual: true,
    });
  });

  it("shekels, an older row with no currency, and a half-filled row are all shekels", () => {
    expect(readForeignMoney({ currency: "ILS", foreign_amount: null, fx_rate: null })).toBeNull();
    expect(readForeignMoney({})).toBeNull();
    expect(readForeignMoney({ currency: null })).toBeNull();
    expect(readForeignMoney({ currency: "USD", foreign_amount: null, fx_rate: "3.1" })).toBeNull();
    expect(readForeignMoney({ currency: "EUR", foreign_amount: 10, fx_rate: 3.6 })).toBeNull();
  });
});

describe("foreignShare", () => {
  const dollars = { currency: "USD" as const, amount: 1000, rate: 3.107, rateManual: false };

  it("the whole row keeps its exact amount", () => {
    expect(foreignShare(dollars, 3107, 3107)).toBe(dollars);
  });

  it("a part — a partly paid expense's paid share — at the row's own rate", () => {
    expect(foreignShare(dollars, 1553.5, 3107)).toEqual({ ...dollars, amount: 500 });
  });
});

describe("the money format for US$ and C$", () => {
  it("its symbol first, grouped, cents kept", () => {
    expect(formatCurrencyAmount(1000, "USD")).toBe("$1,000");
    expect(formatCurrencyAmount(1250.5, "CAD")).toBe("C$1,250.5");
    expect(formatCurrencyAmount("66637", "USD")).toBe("$66,637");
    expect(formatCurrencyAmount(-50, "USD")).toBe("-$50");
    expect(formatCurrencyAmount(5000, "ILS")).toBe("₪5,000");
  });

  it("its shekels beside it, whole", () => {
    expect(formatShekelNote(3107.4)).toBe("≈ ₪3,107");
    expect(formatMoneyWithForeign(3107, { currency: "USD", amount: 1000, rate: 3.107, rateManual: false })).toBe(
      "$1,000 (≈ ₪3,107)"
    );
    expect(formatMoneyWithForeign(3107, null)).toBe("₪3,107");
  });
});
