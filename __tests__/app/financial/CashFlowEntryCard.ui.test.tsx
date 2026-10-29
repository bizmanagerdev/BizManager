// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { FinancialEntry } from "@/lib/financial";

// The cash-flow page's ledger and upcoming lists as cards — on a phone, and
// wherever their table doesn't fit (owner's check of every width and text size,
// 2026-10-29: the tables scrolled sideways on a tablet, and the upcoming list had
// no cards at all). A card says what the table's row says, and an unpaid bill's
// card can be marked paid: the table had the ✓, the cards didn't.

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { CashFlowEntryCard, ExpenseStatusLine, MarkPaidButton } from "@/app/(app)/financial/CashFlowEntryCard";
import { CASH_FLOW_LISTS } from "@/app/(app)/financial/FinancialPage.ui";
import { CashFlowSkeleton } from "@/app/(app)/financial/FinancialSkeleton";

/** The electricity bill for November, not paid yet: an expense the office can act on. */
function bill(overrides: Partial<FinancialEntry> = {}): FinancialEntry {
  return {
    id: "expense:e1",
    type: "outflow",
    amount: 350,
    signedAmount: -350,
    businessDomain: "general_business",
    domainName: "שוטף",
    flowDate: "2026-11-10",
    recordedDate: "2026-11-10",
    dueDate: null,
    stage: "scheduled",
    sourceKind: "general",
    sourceId: null,
    sourceLabel: "שוטף",
    sourceHref: null,
    description: "חשמל",
    origin: "expense",
    reference: null,
    paymentMethod: null,
    paymentMethodLabel: null,
    paymentStatus: "not_paid",
    recordedByName: "מנהל",
    createdAt: "2026-10-01T09:00:00.000Z",
    customerId: null,
    searchText: "חשמל",
    expenseId: "e1",
    ...overrides,
  } as FinancialEntry;
}

function card(entry: FinancialEntry, props: { canManage?: boolean; showDueDate?: boolean } = {}) {
  const calls = { open: vi.fn(), markPaid: vi.fn(), edit: vi.fn(), remove: vi.fn() };
  render(
    <CashFlowEntryCard
      entry={entry}
      todayIso="2026-10-29"
      paint={(text) => text ?? ""}
      canManage={props.canManage ?? true}
      showDueDate={props.showDueDate}
      onOpen={calls.open}
      onMarkPaid={calls.markPaid}
      onEdit={calls.edit}
      onDelete={calls.remove}
    />
  );
  return calls;
}

describe("a cash-flow row as a card", () => {
  it("an unpaid bill: marked paid from the card (its own window), not opened", () => {
    const calls = card(bill());
    fireEvent.click(screen.getByRole("button", { name: "סמן כשולם" }));
    expect(calls.markPaid).toHaveBeenCalledWith(expect.objectContaining({ expenseId: "e1" }));
    expect(calls.open).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "עריכה" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "מחיקה" })).toBeTruthy();
  });

  it("a paid bill: edit and delete, no ✓", () => {
    card(bill({ paymentStatus: "paid", expensePaymentMethod: "bank_transfer", stage: "posted" }));
    expect(screen.queryByRole("button", { name: "סמן כשולם" })).toBeNull();
    expect(screen.getByRole("button", { name: "עריכה" })).toBeTruthy();
    expect(screen.getByText("שולם")).toBeTruthy();
    expect(screen.getByText("העברה בנקאית")).toBeTruthy();
  });

  it("a partly paid bill keeps its ✓, and says how much went", () => {
    card(bill({ paymentStatus: "partial", expensePaidAmount: 100 }));
    expect(screen.getByRole("button", { name: "סמן כשולם" })).toBeTruthy();
    expect(screen.getByText("חלקית")).toBeTruthy();
    expect(screen.getByText("שולם ₪100")).toBeTruthy();
  });

  it("money in the app's one shape, the ₪ before the number (lib/money) — it was Intl's ‏350 ‏₪", () => {
    card(bill({ amount: 1350.5 }));
    expect(screen.getByText("-₪1,350.5")).toBeTruthy();
    document.body.innerHTML = "";
    card(bill({ id: "payment:p1", type: "inflow", origin: "payment", expenseId: null, amount: 5000 }));
    expect(screen.getByText("+₪5,000")).toBeTruthy();
    document.body.innerHTML = "";
    card(bill({ amount: 3107, foreign: { amount: 1000, currency: "USD" } as FinancialEntry["foreign"] }));
    expect(screen.getByText("-$1,000")).toBeTruthy();
    expect(screen.getByText("≈ ₪3,107")).toBeTruthy();
  });

  it("no actions for someone who can't manage expenses, nor on money that came in", () => {
    card(bill(), { canManage: false });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    document.body.innerHTML = "";
    card(bill({ id: "payment:p1", type: "inflow", origin: "payment", expenseId: null, paymentStatus: "cleared", description: "תשלום מלקוח" }));
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("the upcoming list's card shows the due date when it isn't the row's own", () => {
    card(bill({ dueDate: "2026-11-25" }), { showDueDate: true });
    expect(screen.getByText("פירעון")).toBeTruthy();
    expect(screen.getByText("25/11/26")).toBeTruthy();
    document.body.innerHTML = "";
    card(bill({ dueDate: "2026-11-10" }), { showDueDate: true });
    expect(screen.queryByText("פירעון")).toBeNull();
    document.body.innerHTML = "";
    card(bill({ dueDate: "2026-11-25" }));
    expect(screen.queryByText("פירעון")).toBeNull();
  });

  it("a row with a source opens it from anywhere on the card", () => {
    const calls = card(bill({ sourceHref: "/projects/p1", sourceLabel: "הובלה" }));
    fireEvent.click(screen.getByText("חשמל"));
    expect(calls.open).toHaveBeenCalledTimes(1);
  });
});

describe("a bill's row in the tables", () => {
  it("the ✓ is the card's own: outlined green, named on hover, the size of edit and delete beside it", () => {
    const onClick = vi.fn();
    render(<MarkPaidButton onClick={onClick} />);
    const button = screen.getByRole("button", { name: "סמן כשולם" });
    expect(button.getAttribute("title")).toBe("סמן כשולם");
    expect(button.className).toContain("border-success");
    expect(button.className).toContain("h-9 w-9");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("its status line is in the app's small size, and says how much of a partly paid bill went", () => {
    const { container } = render(<ExpenseStatusLine entry={bill({ paymentStatus: "partial", expensePaidAmount: 100, expensePaymentMethod: "cash" })} />);
    expect(screen.getByText("חלקית").className).toContain("text-[0.647rem]");
    expect(screen.getByText("שולם ₪100 • מזומן")).toBeTruthy();
    expect(container.innerHTML).not.toContain("0.588rem");
  });
});

describe("the table where it fits, the cards where it doesn't", () => {
  it("each list shows its cards exactly where its table is hidden, measured in the text's size (rem)", () => {
    for (const list of Object.values(CASH_FLOW_LISTS)) {
      const width = /@min-\[([\d.]+rem)\]:hidden/.exec(list.cards)?.[1];
      expect(width).toBeTruthy();
      expect(list.table).toBe(`hidden md:@min-[${width}]:block`);
      expect(list.cards).toBe(`md:@min-[${width}]:hidden`);
    }
  });

  it("the loading placeholder switches its history list at the page's own width — nothing changes shape when the page arrives", () => {
    const { container } = render(<CashFlowSkeleton />);
    const cards = container.querySelector(`[class*="${CASH_FLOW_LISTS.history.cards}"]`);
    const table = container.querySelector("table")?.parentElement;
    expect(cards?.className).toContain("grid");
    expect(table?.className).toContain(CASH_FLOW_LISTS.history.table);
    expect(cards?.closest(".\\@container")).toBe(table?.closest(".\\@container"));
    expect(cards?.closest(".\\@container")).not.toBeNull();
  });
});
