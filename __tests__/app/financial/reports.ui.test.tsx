// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import BottomLinePanel from "@/app/(app)/financial/reports/BottomLinePanel";
import ProfitLossPanel from "@/app/(app)/financial/reports/ProfitLossPanel";
import EarnedRevenuePanel from "@/app/(app)/financial/reports/EarnedRevenuePanel";
import { buildEarnedRevenueByMonth } from "@/lib/financial/earnedRevenue";
import type { ProfitLossCategoryRow, ProfitLossDomainRow } from "@/lib/financial";

// Owner, 2026-10-13: the expense table follows the בית/צדקה and ניהול נכסים
// checkboxes, and a ticked area counts by the same rule as every other.
// These pin what the reports show once property is included.

const row = (domain: ProfitLossDomainRow["domain"], domainName: string, revenue: number, expense: number, isPersonal = false): ProfitLossDomainRow => ({
  domain,
  domainName,
  isPersonal,
  cashRevenue: revenue,
  cashExpense: expense,
  accrualRevenue: revenue,
  accrualExpense: expense,
});

const rows: ProfitLossDomainRow[] = [
  row("sales", "מכירות", 1000, 200),
  row("general_business", "שוטף", 0, 300),
  row("property_management", "ניהול נכסים", 500, 100, true),
];

describe("סקירה — property adds to what's left", () => {
  it("labels a positive property result as added, with its own sign in the headline", () => {
    render(<BottomLinePanel rows={rows} earned={null} basis="cash" includeHomeCharity={false} includeProperties />);
    expect(screen.getByText("ועוד ניהול נכסים")).toBeTruthy();
    expect(screen.queryByText("פחות ניהול נכסים")).toBeNull();
    const headline = screen.getByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").startsWith("רווח מהעסקים"));
    expect(headline.textContent).toMatch(/− שוטף/);
    expect(headline.textContent).toMatch(/\+ נכסים/);
    expect(headline.textContent).not.toMatch(/נכסים\s*-/);
  });
});

describe("לפי תחום — expenses by category follow the toggles", () => {
  const categories: ProfitLossCategoryRow[] = [
    { category: "דלק", domain: "general_business", cashExpense: 300, accrualExpense: 300 },
    { category: "ארנונה", domain: "property_management", cashExpense: 100, accrualExpense: 100 },
  ];
  const renderPanel = (includeProperties: boolean) =>
    render(
      <ProfitLossPanel
        rows={rows}
        earned={null}
        expenseCategories={categories}
        previousRows={[]}
        previousPeriod={null}
        from="2026-10-01"
        to="2026-10-31"
        basis="cash"
        includeHomeCharity={false}
        includeProperties={includeProperties}
        selectedDomains={[]}
      />
    );

  it("shows property expenses when ניהול נכסים is included", () => {
    renderPanel(true);
    expect(screen.getByText("ארנונה")).toBeTruthy();
    expect(screen.getByText("דלק")).toBeTruthy();
  });

  it("hides them when it isn't", () => {
    renderPanel(false);
    expect(screen.queryByText("ארנונה")).toBeNull();
    expect(screen.getByText("דלק")).toBeTruthy();
  });
});

describe("הרווחתי — בית/נכסים by the same rule, behind their checkboxes (owner, 2026-10-13)", () => {
  // Property: rent 4,000 for the month (not collected yet) against 4,900 of costs
  // (wages still owed included) — the earned figures, not money that moved.
  const earned = buildEarnedRevenueByMonth(
    [{ orderDate: "2026-10-05", amount: 1000, status: "delivered" }],
    [],
    [
      { date: "2026-10-03", amount: 200, domain: "sales" },
      { date: "2026-10-03", amount: 300, domain: "general_business" },
      { date: "2026-10-01", amount: 4900, domain: "property_management" },
    ],
    [{ date: "2026-10-01", amount: 4000, domain: "property_management" }]
  );

  it("adds property right after what the businesses made, before שוטף, from the earned figures", () => {
    render(<BottomLinePanel rows={rows} earned={earned} basis="earned" includeHomeCharity={false} includeProperties />);
    expect(screen.getByText("ועוד ניהול נכסים")).toBeTruthy();
    expect(screen.getByText("סה״כ עם ניהול נכסים")).toBeTruthy();
    const headline = screen.getByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").startsWith("רווח מהעסקים"));
    // businesses 800 → − נכסים 900 → − שוטף 300 = −400
    expect(headline.textContent).toMatch(/רווח מהעסקים[^−]*800[^−]*− נכסים[^−]*900[^−]*− שוטף[^−]*300/);
    const text = document.body.textContent ?? "";
    expect(text.indexOf("ועוד ניהול נכסים")).toBeLessThan(text.indexOf("פחות תקורה כללית"));
  });

  it("leaves property out when not ticked", () => {
    render(<BottomLinePanel rows={rows} earned={earned} basis="earned" includeHomeCharity={false} includeProperties={false} />);
    expect(screen.queryByText(/ניהול נכסים/)).toBeNull();
  });

  it("the monthly tab shows property only when ticked", () => {
    const { unmount } = render(
      <EarnedRevenuePanel report={earned} selectedDomains={[]} includeHomeCharity={false} includeProperties={false} />
    );
    expect(screen.queryByText("ניהול נכסים")).toBeNull();
    unmount();
    render(<EarnedRevenuePanel report={earned} selectedDomains={[]} includeHomeCharity={false} includeProperties />);
    expect(screen.getAllByText("ניהול נכסים").length).toBeGreaterThan(0);
  });
});
