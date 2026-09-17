// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const searchParams = { value: new URLSearchParams() };
vi.mock("next/navigation", async () => {
  const base = await import("@/__tests__/mocks/next-navigation");
  return { ...base, useSearchParams: () => searchParams.value };
});
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/reminders/ReminderFormDialog", () => ({ default: () => null }));
// The two tabs' contents are covered by their own tests; this is about the header.
vi.mock("@/app/(app)/financial/RecurringExpensesManager", () => ({ default: () => null }));
vi.mock("@/app/(app)/financial/payments-calendar/PaymentsCalendar", () => ({
  default: ({ direction }: { direction: string }) => <div data-testid="board">{direction}</div>,
  CashNeedsDialog: () => null,
}));

const replaceSearchParams = vi.fn();
vi.mock("@/lib/ui/url-state", () => ({ replaceSearchParams: (u: unknown) => replaceSearchParams(u) }));

import PaymentsHubClient from "@/app/(app)/financial/payments-calendar/PaymentsHubClient";
import type { PaymentCalendarItem } from "@/lib/payables";

function item(over: Partial<PaymentCalendarItem> & { id: string }): PaymentCalendarItem {
  return {
    direction: "out", date: "2026-09-20", amount: 100, label: "x", sourceLabel: "", sourceHref: null,
    stage: "pending", paymentStatus: null, origin: "expense", sourceId: null, domainName: "",
    expenseId: null, category: null, businessDomain: null, accountId: null, paidAmount: null,
    descriptionRaw: null, notes: null, paymentMethod: null, dueDate: "2026-09-20", paidDate: null,
    overdue: false, installmentGroupId: null, installmentIndex: null, installmentCount: null,
    expenseProjectId: null, expenseOrderId: null, expensePropertyId: null, workerUserId: null,
    recurringTemplateId: null, recurrenceKey: null, variableAmount: false, autoPaid: false,
    ...over,
  };
}

const items = [
  item({ id: "expense:e1" }),
  item({ id: "payment:p1", direction: "in", origin: "payment", paymentId: "p1" }),
];

function renderHub() {
  return render(
    <PaymentsHubClient
      items={items}
      todayIso="2026-09-16"
      templates={[]}
      projects={[]}
      properties={[]}
      orders={[]}
      accounts={[]}
      incomeOptions={{ projects: [], orders: [], properties: [] }}
      expenseMissingSchema={false}
    />
  );
}

beforeEach(() => {
  searchParams.value = new URLSearchParams();
  replaceSearchParams.mockClear();
});

describe("PaymentsHubClient \u2014 the direction switch", () => {
  it("names the board tab לוח תזרים", () => {
    renderHub();
    expect(screen.getByRole("tab", { name: /לוח תזרים/ })).toBeTruthy();
  });

  it("offers the three directions and opens on outgoing", () => {
    renderHub();
    const group = screen.getByRole("group", { name: "\u05db\u05d9\u05d5\u05d5\u05df \u05d4\u05db\u05e1\u05e3" });
    expect(group.textContent).toBe("\u05d9\u05d5\u05e6\u05d0\u05e0\u05db\u05e0\u05e1\u05d4\u05db\u05dc");
    expect(screen.getByRole("button", { name: "\u05d9\u05d5\u05e6\u05d0" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("board").textContent).toBe("out");
  });

  it("switches the board and writes the choice to the URL, keeping outgoing clean", () => {
    renderHub();
    fireEvent.click(screen.getByRole("button", { name: "\u05e0\u05db\u05e0\u05e1" }));
    expect(screen.getByTestId("board").textContent).toBe("in");
    expect(replaceSearchParams).toHaveBeenCalledWith({ dir: "in" });
    fireEvent.click(screen.getByRole("button", { name: "\u05d9\u05d5\u05e6\u05d0" }));
    expect(replaceSearchParams).toHaveBeenCalledWith({ dir: null });
  });

  it("restores the direction from the URL", () => {
    searchParams.value = new URLSearchParams("dir=all");
    renderHub();
    expect(screen.getByTestId("board").textContent).toBe("all");
  });

  it("a deep link to an incoming item opens on the incoming board", () => {
    // Otherwise the alert would land on a board its item isn't even on.
    searchParams.value = new URLSearchParams("focus=payment:p1");
    renderHub();
    expect(screen.getByTestId("board").textContent).toBe("in");
  });

  it("an explicit direction still wins over the focused item", () => {
    searchParams.value = new URLSearchParams("focus=payment:p1&dir=all");
    renderHub();
    expect(screen.getByTestId("board").textContent).toBe("all");
  });
});

describe("PaymentsHubClient — the switch does not move", () => {
  // It used to sit at the moving edge of the controls group, so showing or
  // hiding a filter shoved it sideways under the pointer. It now shares a fixed
  // cluster with the tabs, which never change width. Layout can't be measured
  // in jsdom, so this locks the structure that guarantees it.
  it("sits in the same cluster as the tabs, not among the controls that grow and shrink", () => {
    renderHub();
    const tabs = screen.getByRole("tablist");
    const switchGroup = screen.getByRole("group", { name: "כיוון הכסף" });
    expect(switchGroup.parentElement).toBe(tabs.parentElement);
    // And the cash calculator — part of the variable side — is NOT in there.
    const cashButton = screen.getByRole("button", { name: /כמה צריך/ });
    expect(cashButton.parentElement).not.toBe(tabs.parentElement);
  });
});
