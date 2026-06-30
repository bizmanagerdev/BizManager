import { describe, it, expect } from "vitest";
import { buildEarnedRevenueByMonth, monthKeysBetween } from "@/lib/financial/earnedRevenue";
import type {
  EarnedOrderInput,
  EarnedProjectInput,
  EarnedExpenseInput,
  EarnedIncomeInput,
} from "@/lib/financial/earnedRevenue";

// Earned (booked/accrual) revenue: money is attributed to the month the work
// BELONGS to, not the month cash cleared. Orders book on order_date; projects
// prorate evenly across their span; expenses fall on their date. GROSS amounts.

function build(
  parts: {
    orders?: EarnedOrderInput[];
    projects?: EarnedProjectInput[];
    expenses?: EarnedExpenseInput[];
    income?: EarnedIncomeInput[];
  },
  options: { from?: string | null; to?: string | null } = {}
) {
  return buildEarnedRevenueByMonth(
    parts.orders ?? [],
    parts.projects ?? [],
    parts.expenses ?? [],
    parts.income ?? [],
    options
  );
}

describe("monthKeysBetween", () => {
  it("returns an inclusive list of YYYY-MM keys", () => {
    expect(monthKeysBetween("2024-01", "2024-04")).toEqual(["2024-01", "2024-02", "2024-03", "2024-04"]);
  });
  it("crosses a year boundary", () => {
    expect(monthKeysBetween("2024-11", "2025-02")).toEqual(["2024-11", "2024-12", "2025-01", "2025-02"]);
  });
  it("a single month returns just that month", () => {
    expect(monthKeysBetween("2024-05", "2024-05")).toEqual(["2024-05"]);
  });
  it("an end before the start collapses to the start month", () => {
    expect(monthKeysBetween("2024-05", "2024-01")).toEqual(["2024-05"]);
  });
});

describe("buildEarnedRevenueByMonth — orders", () => {
  it("books the whole order total into its order_date month under 'sales'", () => {
    const report = build({ orders: [{ orderDate: "2024-05-10", amount: 1000, status: "completed" }] });
    const may = report.months.find((m) => m.month === "2024-05");
    expect(may?.byDomain.sales.income).toBe(1000);
    expect(may?.byDomain.sales.count).toBe(1);
  });

  it("excludes cancelled orders", () => {
    const report = build({ orders: [{ orderDate: "2024-05-10", amount: 1000, status: "cancelled" }] });
    expect(report.months).toHaveLength(0);
  });

  it("skips orders without an order date", () => {
    const report = build({ orders: [{ orderDate: null, amount: 1000, status: "completed" }] });
    expect(report.months).toHaveLength(0);
  });
});

describe("buildEarnedRevenueByMonth — projects (prorated)", () => {
  it("spreads the gross price evenly across every month of the span", () => {
    const project: EarnedProjectInput = {
      startDate: "2024-01-01",
      endDate: "2024-03-31",
      createdAt: null,
      amount: 900,
      status: "active",
    };
    const report = build({ projects: [project] });
    const months = report.months.map((m) => m.month);
    expect(months).toEqual(["2024-01", "2024-02", "2024-03"]);
    for (const m of report.months) {
      expect(m.byDomain.logistics_projects.income).toBeCloseTo(300, 6);
      expect(m.byDomain.logistics_projects.count).toBe(1); // counts once per active month
    }
  });

  it("a project with no end date books a single month", () => {
    const report = build({
      projects: [{ startDate: "2024-02-01", endDate: null, createdAt: null, amount: 500, status: "active" }],
    });
    expect(report.months).toHaveLength(1);
    expect(report.months[0].byDomain.logistics_projects.income).toBe(500);
  });

  it("falls back to createdAt when there is no start date", () => {
    const report = build({
      projects: [{ startDate: null, endDate: null, createdAt: "2024-07-15", amount: 200, status: "active" }],
    });
    expect(report.months[0].month).toBe("2024-07");
  });

  it("excludes quote and cancelled projects", () => {
    const report = build({
      projects: [
        { startDate: "2024-01-01", endDate: null, createdAt: null, amount: 100, status: "quote" },
        { startDate: "2024-01-01", endDate: null, createdAt: null, amount: 100, status: "cancelled" },
      ],
    });
    expect(report.months).toHaveLength(0);
  });
});

describe("buildEarnedRevenueByMonth — expenses & other income", () => {
  it("books an expense by date into its business domain", () => {
    const report = build({ expenses: [{ date: "2024-05-01", amount: 250, domain: "sales" }] });
    expect(report.months[0].byDomain.sales.expense).toBe(250);
  });

  it("ignores expenses in personal/unknown domains", () => {
    const report = build({
      expenses: [
        { date: "2024-05-01", amount: 250, domain: "home" },
        { date: "2024-05-01", amount: 250, domain: "charity" },
      ],
    });
    expect(report.months).toHaveLength(0);
  });

  it("books other-domain income (spaceit/general/property) but not order/project domains", () => {
    const report = build({
      income: [
        { date: "2024-05-01", amount: 300, domain: "spaceit" },
        { date: "2024-05-01", amount: 999, domain: "sales" }, // not an other-income domain → ignored
      ],
    });
    expect(report.months[0].byDomain.spaceit.income).toBe(300);
    expect(report.domains.map((d) => d.key)).not.toContain("sales");
  });

  it("net = income − expense per domain per month", () => {
    const report = build({
      orders: [{ orderDate: "2024-05-01", amount: 1000, status: "completed" }],
      expenses: [{ date: "2024-05-01", amount: 400, domain: "sales" }],
    });
    expect(report.months[0].byDomain.sales.net).toBe(600);
    expect(report.months[0].total.net).toBe(600);
  });
});

describe("buildEarnedRevenueByMonth — windowing & totals", () => {
  it("from/to trims returned months but proration still uses the full span", () => {
    const project: EarnedProjectInput = {
      startDate: "2024-01-01",
      endDate: "2024-03-31",
      createdAt: null,
      amount: 900,
      status: "active",
    };
    const report = build({ projects: [project] }, { from: "2024-02-01", to: "2024-02-29" });
    expect(report.months.map((m) => m.month)).toEqual(["2024-02"]);
    // share stays 900/3 = 300, NOT 900/1 — full-span proration happens first.
    expect(report.months[0].byDomain.logistics_projects.income).toBeCloseTo(300, 6);
  });

  it("aggregates grand totals across months and domains", () => {
    const report = build({
      orders: [
        { orderDate: "2024-05-01", amount: 1000, status: "completed" },
        { orderDate: "2024-06-01", amount: 500, status: "completed" },
      ],
      expenses: [{ date: "2024-05-01", amount: 200, domain: "sales" }],
    });
    expect(report.totals.byDomain.sales.income).toBe(1500);
    expect(report.totals.byDomain.sales.expense).toBe(200);
    expect(report.totals.grand.net).toBe(1300);
  });

  it("returns domains in the fixed display order, only those with activity", () => {
    const report = build({
      orders: [{ orderDate: "2024-05-01", amount: 100, status: "completed" }],
      income: [{ date: "2024-05-01", amount: 100, domain: "spaceit" }],
    });
    expect(report.domains.map((d) => d.key)).toEqual(["sales", "spaceit"]);
  });
});
