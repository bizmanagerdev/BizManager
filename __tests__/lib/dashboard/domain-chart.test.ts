import { describe, it, expect } from "vitest";
import {
  isMonthKey,
  monthChoices,
  monthKeyOf,
  monthLabel,
  monthWindow,
  previousMonth,
  toBars,
} from "@/lib/dashboard/domain-chart";

// The month picker on the dashboard's "הכנסות והוצאות לפי תחום" card. The math
// here decides which cash the chart counts, so it's locked rather than eyeballed.

describe("monthWindow — the chart's date range", () => {
  it("stops the CURRENT month at today, not at its last day", () => {
    // Otherwise "this month" would silently include cash dated later in the month
    // (a payment recorded as paid ahead of time) and read as money already in.
    expect(monthWindow("2026-08", "2026-08-18")).toEqual({ from: "2026-08-01", to: "2026-08-18" });
  });

  it("runs a past month to its last day", () => {
    expect(monthWindow("2026-07", "2026-08-18")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(monthWindow("2026-02", "2026-08-18")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    // Leap February, from the month-end-by-day-0 trick rather than a table.
    expect(monthWindow("2024-02", "2026-08-18")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });
});

describe("monthChoices — what the picker offers", () => {
  it("opens on the current month and walks backwards across the year boundary", () => {
    const choices = monthChoices("2026-01-09", 3);
    expect(choices.map((c) => c.value)).toEqual(["2026-01", "2025-12", "2025-11"]);
    expect(choices[0].label).toBe("ינואר 2026");
    expect(choices[1].label).toBe("דצמבר 2025");
  });
});

describe("month keys", () => {
  it("formats a local date without drifting a day on the UTC conversion", () => {
    // Israel is ahead of UTC, so a toISOString() month key can land in the
    // previous month for a date on the 1st.
    expect(monthKeyOf(new Date(2026, 7, 1, 0, 30))).toBe("2026-08");
  });

  it("rejects anything that isn't YYYY-MM — the action takes it from the client", () => {
    expect(isMonthKey("2026-08")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-00")).toBe(false);
    expect(isMonthKey("2026-8")).toBe(false);
    expect(isMonthKey("")).toBe(false);
    expect(isMonthKey(null)).toBe(false);
  });

  it("falls back to the raw key rather than printing undefined", () => {
    expect(monthLabel("2026-99")).toBe("2026-99");
  });
});

describe("toBars — only domains that moved money get a bar", () => {
  it("drops the all-zero rows and keeps one-sided ones", () => {
    expect(
      toBars([
        { domainName: "פרויקטים", inflow: 140000, outflow: 45000 },
        { domainName: "בית", inflow: 0, outflow: 9000 },
        { domainName: "רכב", inflow: 0, outflow: 0 },
      ])
    ).toEqual([
      { name: "פרויקטים", inflow: 140000, outflow: 45000, prevInflow: 0, prevOutflow: 0 },
      { name: "בית", inflow: 0, outflow: 9000, prevInflow: 0, prevOutflow: 0 },
    ]);
  });

  it("carries last month's numbers onto the matching domain", () => {
    expect(
      toBars(
        [{ domainName: "פרויקטים", inflow: 140000, outflow: 45000 }],
        [{ domainName: "פרויקטים", inflow: 90000, outflow: 51000 }]
      )
    ).toEqual([
      { name: "פרויקטים", inflow: 140000, outflow: 45000, prevInflow: 90000, prevOutflow: 51000 },
    ]);
  });

  it("keeps a domain that ran LAST month and stopped — that's what a baseline is for", () => {
    expect(
      toBars(
        [{ domainName: "פרויקטים", inflow: 10, outflow: 0 }],
        [{ domainName: "שוטף", inflow: 0, outflow: 8000 }]
      )
    ).toEqual([
      { name: "פרויקטים", inflow: 10, outflow: 0, prevInflow: 0, prevOutflow: 0 },
      { name: "שוטף", inflow: 0, outflow: 0, prevInflow: 0, prevOutflow: 8000 },
    ]);
  });

  it("still drops a domain that moved nothing in EITHER month", () => {
    expect(
      toBars(
        [{ domainName: "רכב", inflow: 0, outflow: 0 }],
        [{ domainName: "רכב", inflow: 0, outflow: 0 }]
      )
    ).toEqual([]);
  });
});

describe("previousMonth", () => {
  it("steps back one month", () => {
    expect(previousMonth("2026-08")).toBe("2026-07");
  });

  it("crosses the year boundary", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
  });
});
