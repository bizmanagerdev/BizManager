import { describe, it, expect } from "vitest";
import type { FinancialEntry, FinancialPageData } from "@/lib/financial";
import {
  FIRST_UPCOMING_ENTRIES,
  firstLedgerSlice,
  flowViewData,
  normalizeFinancialSearchParams,
  reportsViewData,
} from "@/lib/financial/cashFlowPage";

// What each finance view sends with the page: /financial its newest ledger
// rows (the browser loads the rest from /api/financial/entries), and
// /financial/reports no ledger lists at all.

const entry = (id: string, flowDate: string) => ({ id, flowDate }) as FinancialEntry;

function pageData(overrides: Partial<FinancialPageData> = {}): FinancialPageData {
  return {
    todayIso: "2026-10-05",
    ledgerEntries: [],
    upcomingEntries: [],
    ledgerTotalCount: 0,
    upcomingTotalCount: 0,
    domainGroups: [{ domain: null }],
    profitLoss: [{ domain: "sales" }],
    profitLossProof: { sales: [] },
    profitLossExpenseCategories: [{ category: "x" }],
    profitLossPrevious: [{ domain: "sales" }],
    monthlyTrend: [{ month: "2026-09" }],
    forecastMonthly: [{ month: "2026-11" }],
    ...overrides,
  } as unknown as FinancialPageData;
}

describe("firstLedgerSlice", () => {
  it("keeps every entry dated after today, then the most recent past ones", () => {
    const ledger = [
      entry("f1", "2030-01-01"),
      entry("f2", "2026-12-01"),
      entry("p1", "2026-10-05"),
      entry("p2", "2026-10-01"),
      entry("p3", "2026-09-01"),
    ];
    expect(firstLedgerSlice(ledger, "2026-10-05", 2).map((e) => e.id)).toEqual(["f1", "f2", "p1", "p2"]);
  });

  it("returns the whole list when it's shorter than the slice", () => {
    const ledger = [entry("f1", "2030-01-01"), entry("p1", "2026-01-01")];
    expect(firstLedgerSlice(ledger, "2026-10-05", 150)).toEqual(ledger);
  });
});

describe("flowViewData", () => {
  it("sends the newest rows and says the lists are partial", () => {
    const ledger = Array.from({ length: 400 }, (_, i) => entry(`p${i}`, "2026-01-01"));
    const upcoming = Array.from({ length: 300 }, (_, i) => entry(`u${i}`, "2026-11-01"));
    const { data, entriesPartial } = flowViewData(pageData({ ledgerEntries: ledger, upcomingEntries: upcoming }));
    expect(data.ledgerEntries).toHaveLength(150);
    expect(data.ledgerEntries[0].id).toBe("p0");
    expect(data.upcomingEntries).toHaveLength(FIRST_UPCOMING_ENTRIES);
    expect(data.upcomingEntries[0].id).toBe("u0");
    expect(entriesPartial).toBe(true);
  });

  it("is complete when everything fits", () => {
    const { entriesPartial } = flowViewData(
      pageData({ ledgerEntries: [entry("p1", "2026-01-01")], upcomingEntries: [entry("u1", "2026-11-01")] })
    );
    expect(entriesPartial).toBe(false);
  });

  it("drops the reports-only data and keeps the totals", () => {
    const { data } = flowViewData(pageData({ ledgerTotalCount: 1523 }));
    expect(data.ledgerTotalCount).toBe(1523);
    expect(data.profitLoss).toEqual([]);
    expect(data.profitLossProof).toEqual({});
    expect(data.profitLossExpenseCategories).toEqual([]);
    expect(data.profitLossPrevious).toEqual([]);
    expect(data.monthlyTrend).toEqual([]);
    expect(data.forecastMonthly).toEqual([]);
    expect(data.domainGroups).toEqual([]);
  });
});

describe("reportsViewData", () => {
  it("drops the ledger lists and keeps every report", () => {
    const full = pageData({ ledgerEntries: [entry("p1", "2026-01-01")], upcomingEntries: [entry("u1", "2026-11-01")] });
    const data = reportsViewData(full);
    expect(data.ledgerEntries).toEqual([]);
    expect(data.upcomingEntries).toEqual([]);
    expect(data.profitLoss).toBe(full.profitLoss);
    expect(data.profitLossProof).toBe(full.profitLossProof);
    expect(data.monthlyTrend).toBe(full.monthlyTrend);
    expect(data.forecastMonthly).toBe(full.forecastMonthly);
  });
});

describe("normalizeFinancialSearchParams", () => {
  it("reads the filters the way the page always has", () => {
    expect(
      normalizeFinancialSearchParams({ from: " 2026-01-01 ", type: "inflow", stage: "nope", ledgerPage: "3", q: ["a", "b"] })
    ).toEqual({
      from: "2026-01-01",
      to: "",
      domain: "",
      sourceId: "",
      type: "inflow",
      stage: "all",
      q: "a",
      ledgerPage: 3,
      upcomingPage: 1,
    });
  });
});
