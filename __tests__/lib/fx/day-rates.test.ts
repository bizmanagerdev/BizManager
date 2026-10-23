import { describe, expect, it } from "vitest";
import {
  addInEachCurrency,
  amountInEachCurrency,
  inEachCurrency,
  loadRateTable,
  rateOn,
  type RateTable,
} from "@/lib/fx/day-rates";

// Money in ₪, $ and C$ at once (owner, 2026-10-23, the Canada buildings: "I
// need to see all three … how much did I pay there, the totals"): each
// movement at its own day's rate.

const TABLE: RateTable = {
  // Thursday 22/10, then Monday 26/10 — no rate on the weekend.
  USD: { days: ["2026-10-22", "2026-10-26"], rates: [3.1, 3.2] },
  CAD: { days: ["2026-10-22", "2026-10-26"], rates: [2.2, 2.3] },
};

describe("rateOn", () => {
  it("the day's own rate; a weekend takes the last one before it; none before the table starts", () => {
    expect(rateOn(TABLE, "USD", "2026-10-22")).toBe(3.1);
    expect(rateOn(TABLE, "USD", "2026-10-24")).toBe(3.1);
    expect(rateOn(TABLE, "CAD", "2026-10-26")).toBe(2.3);
    expect(rateOn(TABLE, "CAD", "2026-12-01")).toBe(2.3);
    expect(rateOn(TABLE, "USD", "2026-10-21")).toBeNull();
  });
});

describe("inEachCurrency", () => {
  it("a row in shekels: its shekels, and the day's rate for $ and C$", () => {
    expect(inEachCurrency(3100, "2026-10-24", null, TABLE)).toEqual({ ILS: 3100, USD: 1000, CAD: 3100 / 2.2 });
  });

  it("a row in C$ keeps its own C$ — at its own rate, a typed one too — and its $ is at the day's", () => {
    const foreign = { currency: "CAD" as const, amount: 1000, rate: 2.25, rateManual: true };
    expect(inEachCurrency(2250, "2026-10-26", foreign, TABLE)).toEqual({ ILS: 2250, USD: 2250 / 3.2, CAD: 1000 });
    // A part of it (a partly paid bill): that part of its C$.
    expect(inEachCurrency(1125, "2026-10-26", foreign, TABLE).CAD).toBe(500);
  });

  it("no rates yet, or no day: only the shekels", () => {
    expect(inEachCurrency(3100, "2026-10-24", null, null)).toEqual({ ILS: 3100, USD: null, CAD: null });
    expect(inEachCurrency(3100, null, null, TABLE)).toEqual({ ILS: 3100, USD: null, CAD: null });
  });
});

describe("amountInEachCurrency", () => {
  it("a purchase price in C$: its shekels and dollars at the day's rate", () => {
    expect(amountInEachCurrency(1000, "CAD", "2026-10-22", TABLE)).toEqual({ ILS: 2200, USD: 2200 / 3.1, CAD: 1000 });
  });

  it("no rate: only its own currency", () => {
    expect(amountInEachCurrency(1000, "CAD", "2026-10-22", null)).toEqual({ ILS: null, USD: null, CAD: 1000 });
  });
});

describe("addInEachCurrency", () => {
  it("adds each; one that couldn't be converted leaves that currency unknown", () => {
    expect(addInEachCurrency({ ILS: 1, USD: 2, CAD: 3 }, { ILS: 10, USD: null, CAD: 30 })).toEqual({
      ILS: 11,
      USD: null,
      CAD: 33,
    });
  });
});

describe("loadRateTable", () => {
  it("reads both currencies from ten days before the first day to the last, oldest first", async () => {
    const calls: Array<[string, ...unknown[]]> = [];
    const rows = [
      { currency: "CAD", rate_date: "2026-10-12", rate: "2.2" },
      { currency: "CAD", rate_date: "2026-10-22", rate: "2.21" },
      { currency: "USD", rate_date: "2026-10-12", rate: "3.1" },
      { currency: "USD", rate_date: "2026-10-22", rate: 3.107 },
    ];
    const query = {
      select: (...a: unknown[]) => (calls.push(["select", ...a]), query),
      gte: (...a: unknown[]) => (calls.push(["gte", ...a]), query),
      lte: (...a: unknown[]) => (calls.push(["lte", ...a]), query),
      order: (...a: unknown[]) => (calls.push(["order", ...a]), query),
      range: (...a: unknown[]) => (calls.push(["range", ...a]), Promise.resolve({ data: rows, error: null })),
    };
    const supabase = { from: (table: string) => (calls.push(["from", table]), query) };
    const table = await loadRateTable(supabase as never, "2026-10-20", "2026-10-23");
    expect(calls).toContainEqual(["from", "fx_rates"]);
    expect(calls).toContainEqual(["gte", "rate_date", "2026-10-10"]);
    expect(calls).toContainEqual(["lte", "rate_date", "2026-10-23"]);
    expect(table).toEqual({
      USD: { days: ["2026-10-12", "2026-10-22"], rates: [3.1, 3.107] },
      CAD: { days: ["2026-10-12", "2026-10-22"], rates: [2.2, 2.21] },
    });
  });
});
