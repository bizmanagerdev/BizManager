import { describe, expect, it, vi } from "vitest";
import { currencyPricing, priceMoneyLines, rowDay, signedColumns } from "@/lib/fx/money-input";
import { currencyFieldsFrom, rowCurrencyFields } from "@/lib/fx/currencies";

// How an entry form's typed amount in US$ or C$ becomes the row's columns
// (2026-10-23): its shekels at the day's rate, or the rate typed.

const rpcAnswering = (data: unknown, error: unknown = null) =>
  ({ rpc: vi.fn(async () => ({ data, error })) }) as never as Parameters<typeof currencyPricing>[0] & { rpc: ReturnType<typeof vi.fn> };

describe("currencyPricing", () => {
  it("a form that says nothing leaves the row's currency, and its amounts are shekels", async () => {
    const pricing = await currencyPricing(rpcAnswering(3.1), {}, { amount: 100, date: "2026-10-22" });
    expect(pricing).toMatchObject({ columns: null });
    if ("error" in pricing) throw new Error();
    expect(pricing.toShekels(100)).toBe(100);
  });

  it("shekels say so, and clear any foreign amount", async () => {
    const pricing = await currencyPricing(rpcAnswering(3.1), { currency: "ILS" }, { amount: 100, date: "2026-10-22" });
    expect(pricing).toMatchObject({ columns: { currency: "ILS", foreign_amount: null, fx_rate: null, fx_rate_manual: false } });
  });

  it("dollars at the Bank of Israel rate of the row's day", async () => {
    const supabase = rpcAnswering("3.107000");
    const pricing = await currencyPricing(supabase, { currency: "usd" }, { amount: 1000, date: "2026-10-22T00:00:00+00:00" });
    expect(supabase.rpc).toHaveBeenCalledWith("fx_rate_on", { p_currency: "USD", p_date: "2026-10-22" });
    if ("error" in pricing) throw new Error(pricing.error);
    expect(pricing.columns).toEqual({ currency: "USD", foreign_amount: 1000, fx_rate: 3.107, fx_rate_manual: false });
    expect(pricing.toShekels(1000)).toBe(3107);
    expect(pricing.toShekels(333.33)).toBe(1035.66);
  });

  it("a rate typed by hand, and a bad one refused", async () => {
    const pricing = await currencyPricing(rpcAnswering(3.1), { currency: "USD", fx_rate: "3.05", fx_rate_manual: true }, { amount: 10, date: null });
    if ("error" in pricing) throw new Error(pricing.error);
    expect(pricing.columns).toMatchObject({ fx_rate: 3.05, fx_rate_manual: true });
    await expect(
      currencyPricing(rpcAnswering(3.1), { currency: "USD", fx_rate: "abc", fx_rate_manual: true }, { amount: 10, date: null })
    ).resolves.toEqual({ error: "השער שהוקלד אינו תקין." });
  });

  it("no rate that day, or a currency it doesn't know: why not", async () => {
    await expect(currencyPricing(rpcAnswering(null), { currency: "CAD" }, { amount: 10, date: "2014-01-01" })).resolves.toEqual({
      error: "אין שער יציג לדולר קנדי ליום 01/01/2014 — יש להקליד את השער.",
    });
    await expect(currencyPricing(rpcAnswering(3.6), { currency: "EUR" }, { amount: 10, date: null })).resolves.toEqual({
      error: "מטבע לא מוכר.",
    });
  });
});

describe("rowDay", () => {
  it("a day stays; a timestamp is its Israeli date", () => {
    expect(rowDay("2026-10-22")).toBe("2026-10-22");
    expect(rowDay("2026-10-22T22:30:00Z")).toBe("2026-10-23");
  });
});

describe("an edit form's currency fields", () => {
  it("from read money: shekels say ILS, dollars their four, not read says nothing", () => {
    expect(currencyFieldsFrom(null)).toEqual({ currency: "ILS", foreign_amount: null, fx_rate: null, fx_rate_manual: false });
    expect(currencyFieldsFrom({ currency: "USD", amount: 1000, rate: 3.107, rateManual: true })).toEqual({
      currency: "USD",
      foreign_amount: 1000,
      fx_rate: 3.107,
      fx_rate_manual: true,
    });
    expect(currencyFieldsFrom(undefined)).toEqual({});
  });

  it("from a raw row: nothing when it was read without its currency", () => {
    expect(rowCurrencyFields({ id: "e1", amount: 5 })).toEqual({});
    expect(rowCurrencyFields({ currency: "CAD", foreign_amount: "500", fx_rate: "2.2137", fx_rate_manual: false })).toMatchObject({
      currency: "CAD",
      foreign_amount: 500,
    });
  });
});

describe("an order's payment lines", () => {
  it("each line priced by its position in what the form sent; a line it said nothing for stays as it is", async () => {
    const supabase = rpcAnswering(3.1);
    const priced = await priceMoneyLines(
      supabase,
      [{ currency: "USD" }, {}, { currency: "ILS" }],
      [
        { amount_total: 100, payment_date: "2026-10-22" },
        { amount_total: 500, payment_date: "2026-10-22" },
        { amount_total: -40, payment_date: null },
      ]
    );
    if ("error" in priced) throw new Error(priced.error);
    expect(priced.map((p) => p.shekels)).toEqual([310, 500, 40]);
    expect(priced[0].columns).toMatchObject({ currency: "USD", foreign_amount: 100, fx_rate: 3.1 });
    expect(priced[1].columns).toBeNull();
    expect(priced[2].columns).toMatchObject({ currency: "ILS", foreign_amount: null });
  });

  it("one line without a rate stops them all, saying why", async () => {
    await expect(
      priceMoneyLines(rpcAnswering(null), [{ currency: "CAD" }], [{ amount_total: 10, payment_date: "2014-01-01" }])
    ).resolves.toEqual({ error: "אין שער יציג לדולר קנדי ליום 01/01/2014 — יש להקליד את השער." });
  });

  it("a refund's foreign amount is negative too; shekels and a positive line are left as they are", () => {
    const usd = { currency: "USD" as const, foreign_amount: 50, fx_rate: 3.1, fx_rate_manual: false };
    expect(signedColumns(usd, true)).toEqual({ ...usd, foreign_amount: -50 });
    expect(signedColumns(usd, false)).toBe(usd);
    expect(signedColumns(null, true)).toBeNull();
    const ils = { currency: "ILS" as const, foreign_amount: null, fx_rate: null, fx_rate_manual: false };
    expect(signedColumns(ils, true)).toBe(ils);
  });
});
