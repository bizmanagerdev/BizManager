// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { FinancialEntry, FinancialPageData } from "@/lib/financial";

// The cash-flow page itself (the flow view), after the owner's findings of
// 2026-10-29: the search box was thrown away a moment into typing and a second
// one opened in the filter panel; an expense opened from a link came back after
// it was closed; the income button opened the page's own old form, not the
// wizard; history had no ✓; the ledger had a second month picker; a US$ bill's
// mark-paid window was filled in shekels.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/financial/AccountSelect", () => ({ default: () => null, loadAccounts: vi.fn() }));
vi.mock("@/components/financial/CancelRecurringMonthDialog", () => ({ default: () => null }));
// The reports view's panels (the same client) — not drawn on the flow view.
vi.mock("@/app/(app)/financial/reports/ProfitLossPanel", () => ({ default: () => null }));
vi.mock("@/app/(app)/financial/reports/BottomLinePanel", () => ({ default: () => null }));
vi.mock("@/app/(app)/financial/reports/MonthlyTrendPanel", () => ({ default: () => null }));
vi.mock("@/app/(app)/financial/reports/ForecastPanel", () => ({ default: () => null }));
vi.mock("@/app/(app)/financial/reports/EarnedRevenuePanel", () => ({ default: () => null }));
vi.mock("@/app/(app)/financial/reports/ProductMarginPanel", () => ({ default: () => null }));
vi.mock("@/app/(app)/financial/reports/CustomerRankingPanel", () => ({ default: () => null }));
vi.mock("@/app/(app)/financial/reports/PositionPanel", () => ({ default: () => null }));

import { FinancialPage } from "@/app/(app)/financial/FinancialPageClient";
import { cashFlowPageKey } from "@/app/(app)/financial/FinancialPage.ui";

const summary = { inflow: 0, outflow: 0, net: 0, count: 0 };

function entry(overrides: Partial<FinancialEntry>): FinancialEntry {
  return {
    id: "expense:e1",
    type: "outflow",
    amount: 11505,
    signedAmount: -11505,
    businessDomain: "property_management",
    domainName: "ניהול נכסים",
    flowDate: "2026-10-01",
    recordedDate: "2026-10-01",
    dueDate: null,
    stage: "pending",
    sourceKind: "property",
    sourceId: null,
    sourceLabel: "ריב״ל 29",
    sourceHref: null,
    description: "שיפוצים",
    origin: "expense",
    reference: null,
    paymentMethod: null,
    paymentMethodLabel: null,
    paymentStatus: "not_paid",
    recordedByName: "מנהל",
    createdAt: "2026-10-01T09:00:00.000Z",
    customerId: null,
    searchText: "",
    expenseId: "e1",
    ...overrides,
  } as FinancialEntry;
}

/** A bill from the past, unpaid — history — and a US$ bill of a varying amount, still to come. */
const pastBill = entry({});
const dollarBill = entry({
  id: "expense:e2",
  expenseId: "e2",
  amount: 3107,
  signedAmount: -3107,
  flowDate: "2026-11-10",
  recordedDate: "2026-11-10",
  stage: "scheduled",
  description: "Chase",
  foreign: { amount: 1000, currency: "USD" } as FinancialEntry["foreign"],
  expenseVariableEstimate: true,
});

function pageData(): FinancialPageData {
  return {
    todayIso: "2026-10-29",
    actualSummary: summary,
    futureSummary: summary,
    totalSummary: summary,
    forecastSummary: summary,
    openReceivablesSummary: summary,
    plannedReceivablesSummary: summary,
    openLiabilitiesSummary: summary,
    scheduledLiabilitiesSummary: summary,
    loansSummary: { borrowedOutstanding: 0, lentOutstanding: 0, netPosition: 0 },
    monthlyTrend: [],
    forecastMonthly: [],
    domainOptions: [],
    sourceKind: null,
    sourceOptions: [],
    sourceCount: 0,
    ledgerEntries: [pastBill, dollarBill],
    ledgerTotalCount: 2,
    ledgerPage: 1,
    ledgerTotalPages: 1,
    upcomingEntries: [dollarBill],
    upcomingTotalCount: 1,
    upcomingPage: 1,
    upcomingTotalPages: 1,
  } as unknown as FinancialPageData;
}

const noFilters = { from: "", to: "", domain: "", sourceId: "", type: "all", stage: "all", q: "", ledgerPage: 1, upcomingPage: 1 };

function page(filters: Partial<typeof noFilters> = {}, data = pageData()) {
  return (
    <FinancialPage
      data={data}
      filtersOnDevice
      initialFilters={{ ...noFilters, ...filters }}
      canManageExpenses
      canViewCashflow
      recurringProjects={[]}
      recurringOrders={[]}
      recurringProperties={[]}
    />
  );
}

const searchBoxes = () => screen.getAllByRole("textbox", { name: "חיפוש בתזרים" }) as HTMLInputElement[];

beforeEach(() => {
  window.history.replaceState(null, "", "/financial");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the search", () => {
  it("a search arriving with the page leaves the filter panel shut — its box is the list's, the same on every tab", () => {
    window.history.replaceState(null, "", "/financial?q=%D7%97%D7%A9%D7%9E%D7%9C");
    render(page({ q: "חשמל" }));
    expect(screen.queryByText("מתאריך")).toBeNull();
    expect(searchBoxes()).toHaveLength(3);
    for (const box of searchBoxes()) expect(box.value).toBe("חשמל");
  });

  it("what's typed goes to the address and stays in the box — the space the address trims too", () => {
    vi.useFakeTimers();
    const view = render(page());
    const box = searchBoxes()[0];
    fireEvent.change(box, { target: { value: "חשמל " } });
    act(() => vi.advanceTimersByTime(300));
    expect(new URLSearchParams(window.location.search).get("q")).toBe("חשמל ");
    // The device's answer for it: its filters, trimmed, as the address reads.
    view.rerender(page({ q: "חשמל" }));
    expect(searchBoxes()[0]).toBe(box);
    expect(box.value).toBe("חשמל ");
  });

  it("filters that arrive another way (Back, a link) go into the controls", () => {
    const view = render(page());
    window.history.replaceState(null, "", "/financial?q=%D7%9E%D7%99%D7%9D");
    view.rerender(page({ q: "מים" }));
    for (const box of searchBoxes()) expect(box.value).toBe("מים");
  });

  it("an answer the address has moved past doesn't undo the newer choice", () => {
    const view = render(page());
    window.history.replaceState(null, "", "/financial?q=%D7%9E%D7%99%D7%9D%20%D7%97%D7%9E%D7%99%D7%9D");
    fireEvent.change(searchBoxes()[0], { target: { value: "מים חמים" } });
    view.rerender(page({ q: "מים" }));
    expect(searchBoxes()[0].value).toBe("מים חמים");
  });

  it("a filter or a search never starts the page over — only a customer's own view does", () => {
    const view = { customerId: null, customerPage: "", customerName: "" };
    expect(cashFlowPageKey(view)).toBe(cashFlowPageKey({ ...view }));
    expect(cashFlowPageKey({ ...view, customerId: "c1" })).not.toBe(cashFlowPageKey(view));
  });
});

describe("the lists", () => {
  it("an unpaid bill from the past is marked paid from history too, with its לא שולם", () => {
    const { container } = render(page());
    const row = container.querySelector<HTMLElement>('[role="tabpanel"][id$="history"] tr[data-focus-id="expense:e1"]')!;
    expect(within(row).getByRole("button", { name: "סמן כשולם" })).toBeTruthy();
    expect(within(row).getByText("לא שולם")).toBeTruthy();
  });

  it("the ledger has no month picker of its own — the page's is the one", () => {
    const { container } = render(page());
    const ledger = container.querySelector<HTMLElement>('[role="tabpanel"][id$="ledger"]')!;
    expect(ledger.querySelector("select")).toBeNull();
    expect(screen.queryByText("כל החודשים")).toBeNull();
    expect(screen.getAllByRole("combobox", { name: "בחר חודש" })).toHaveLength(1);
  });

  it("a card swipes open to the same actions on a phone", () => {
    const { container } = render(page());
    const card = container.querySelector('[role="tabpanel"][id$="history"] article[data-focus-id="expense:e1"]')!;
    const strip = card.closest("[data-swipe-owner]")!.firstElementChild as HTMLElement;
    expect(Array.from(strip.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["סמן כשולם", "עריכה", "מחיקה"]);
  });
});

describe("adding and paying", () => {
  it("הוספת הכנסה opens the + menu's step-by-step income wizard", () => {
    const opened = vi.fn();
    window.addEventListener("bizh:quick-create", opened);
    render(page());
    fireEvent.click(screen.getByRole("button", { name: "הוספת הכנסה" }));
    window.removeEventListener("bizh:quick-create", opened);
    expect(opened).toHaveBeenCalledTimes(1);
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({ action: "income" });
    expect(screen.queryByText("יצירת תקבול חדש ישירות מעמוד הפיננסי.")).toBeNull();
  });

  it("a US$ bill of a varying amount is paid in dollars: the window is filled with its dollars, not its shekels", () => {
    const { container } = render(page());
    const row = container.querySelector<HTMLElement>('[role="tabpanel"][id$="upcoming"] tr[data-focus-id="expense:e2"]')!;
    fireEvent.click(within(row).getByRole("button", { name: "סמן כשולם" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("סימון תשלום כשולם")).toBeTruthy();
    const amount = within(dialog).getAllByRole("textbox").find((input) => (input as HTMLInputElement).value.replace(/\D/g, "") === "1000");
    expect(amount).toBeTruthy();
    expect(within(dialog).getAllByText("$").length).toBeGreaterThan(0);
  });
});
