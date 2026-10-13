// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import BottomLinePanel from "@/app/(app)/financial/reports/BottomLinePanel";
import ProfitLossPanel from "@/app/(app)/financial/reports/ProfitLossPanel";
import type { ProfitLossCategoryRow, ProfitLossDomainRow } from "@/lib/financial";

// Owner, 2026-10-13: "כולל ניהול נכסים" is on by default, and the expense
// table follows it. These pin what the reports show once property counts.

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
