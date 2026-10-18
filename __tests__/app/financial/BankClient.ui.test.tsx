// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/layout/page-title-context", () => ({
  useSetHeaderAction: () => {},
  useSetHeaderTrailingAction: () => {},
}));
// The page's dialogs and quick-entry bar aren't under test here.
vi.mock("@/app/(app)/financial/bank/QuickEntryRow", () => ({ default: () => null }));
vi.mock("@/components/financial/AccountTransferDialog", () => ({ AccountTransferDialog: () => null }));
vi.mock("@/components/financial/PaymentEditDialog", () => ({ PaymentEditDialog: () => null }));
vi.mock("@/components/payroll/EditWorkerPaymentDialog", () => ({ EditWorkerPaymentDialog: () => null }));
vi.mock("@/app/(app)/financial/loans/LoanDialogs", () => ({ EditPaidRepaymentDialog: () => null, LoanFormDialog: () => null }));
vi.mock("@/app/(app)/financial/loans/actions", () => ({ deleteLoan: vi.fn(), deleteRepayment: vi.fn() }));
vi.mock("@/lib/financial/cardChargesClient", () => ({ deleteCardCharge: vi.fn() }));
vi.mock("@/lib/financial/transfersClient", () => ({ deleteAccountTransfer: vi.fn() }));

import { toast } from "sonner";
import BankClient from "@/app/(app)/financial/bank/BankClient";
import type { AccountLedgerEntry, AccountWithLedger } from "@/lib/accounts";

// The חשבונות page's "נבדק מול הבנק" ticks (owner, 2026-10-18): a checkbox on
// every register row, what's left on each account's card and month header, and
// a filter for the register.

function row(over: Partial<AccountLedgerEntry> & Pick<AccountLedgerEntry, "id" | "label">): AccountLedgerEntry {
  return {
    date: "2025-01-05",
    sublabel: null,
    href: null,
    type: "out",
    amount: 100,
    posted: true,
    recordedDate: null,
    enteredAt: null,
    enteredByName: null,
    runningBalance: 0,
    bankChecked: false,
    ...over,
  };
}

function account(over: Partial<AccountWithLedger> & Pick<AccountWithLedger, "id" | "name">): AccountWithLedger {
  return {
    kind: "bank",
    openingBalance: 0,
    openingDate: "2025-01-01",
    isActive: true,
    sortOrder: 0,
    notes: null,
    accountNumber: null,
    postedIn: 0,
    postedOut: 0,
    currentBalance: 0,
    pendingIn: 0,
    pendingOut: 0,
    ledger: [],
    ...over,
  };
}

const business = account({
  id: "acc1",
  name: "מזרחי עסקי",
  accountNumber: "594-249395",
  ledger: [
    row({ id: "p:1", label: "תקבול לקוח", type: "in", amount: 500, date: "2025-01-07", bankChecked: true }),
    // expense_date is timestamptz, so this row's date is a timestamp
    row({ id: "e:1", label: "חשמל", amount: 200, date: "2025-01-03T00:00:00+00:00" }),
    row({ id: "w:1", label: "שכר", amount: 50, date: "2025-01-02" }),
    // Still expected — not on the register, not counted.
    row({ id: "e:2:p", label: "ארנונה", posted: false, runningBalance: null }),
  ],
});
const home = account({
  id: "acc2",
  name: "מזרחי בית",
  ledger: [row({ id: "e:9", label: "גן", bankChecked: true })],
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(toast.error).mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const box = (label: string) => screen.getAllByRole("checkbox", { name: new RegExp(`^נבדק מול הבנק: ${label}`) })[0];

describe("BankClient — נבדק מול הבנק", () => {
  it("shows each card's account number and what's left to check", () => {
    render(<BankClient accounts={[business, home]} loans={[]} />);
    expect(screen.getByText("594-249395")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 לא נבדקו" })).toBeInTheDocument();
    expect(screen.getByText("הכל נבדק")).toBeInTheDocument();
    expect(box("תקבול לקוח")).toBeChecked();
    expect(box("חשמל")).not.toBeChecked();
  });

  it("a tick saves the row's signed amount and date, and the count drops", async () => {
    render(<BankClient accounts={[business, home]} loans={[]} />);
    fireEvent.click(box("חשמל"));
    expect(box("חשמל")).toBeChecked();
    expect(screen.getByRole("button", { name: "1 לא נבדקו" })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/accounts/ledger-checks");
    expect(JSON.parse(String(init.body))).toEqual({
      account_id: "acc1",
      entry_key: "e:1",
      amount: -200,
      date: "2025-01-03",
      checked: true,
    });
  });

  it("a save that fails puts the tick back and says so", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "שגיאה" }) });
    render(<BankClient accounts={[business, home]} loans={[]} />);
    fireEvent.click(box("חשמל"));
    await waitFor(() => expect(box("חשמל")).not.toBeChecked());
    expect(toast.error).toHaveBeenCalled();
  });

  it("the card's count shows just the unchecked rows; again shows them all", () => {
    render(<BankClient accounts={[business, home]} loans={[]} />);
    const count = screen.getByRole("button", { name: "2 לא נבדקו" });
    fireEvent.click(count);
    expect(count).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("תקבול לקוח")).not.toBeInTheDocument();
    expect(screen.getAllByText("חשמל").length).toBeGreaterThan(0);
    fireEvent.click(count);
    expect(screen.getAllByText("תקבול לקוח").length).toBeGreaterThan(0);
  });

  it("another account's count opens that account on its unchecked rows", () => {
    const other = account({ id: "acc3", name: "פועלים", ledger: [row({ id: "e:7", label: "עמלה" })] });
    render(<BankClient accounts={[home, other]} loans={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "1 לא נבדקו" }));
    expect(screen.getAllByText("עמלה").length).toBeGreaterThan(0);
    expect(screen.queryByText("גן")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "לא נבדקו" })).toHaveAttribute("aria-pressed", "true");
  });

  it("a cash box has no ticks: no checkbox, no count on its card, no filter", () => {
    const cash = account({
      id: "acc9",
      name: "קופה",
      kind: "cash",
      ledger: [row({ id: "e:5", label: "דלק" }), row({ id: "p:5", label: "תקבול מזומן", type: "in" })],
    });
    render(<BankClient accounts={[cash, business]} loans={[]} />);
    expect(screen.getAllByText("דלק").length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("group", { name: "סינון לפי בדיקה מול הבנק" })).not.toBeInTheDocument();
    // Only the bank account's card has a count.
    expect(screen.getAllByRole("button", { name: /^\d+ לא נבדקו$/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "2 לא נבדקו" })).toBeInTheDocument();
  });

  it("the register's filter shows just the ticked rows, and says when there are none", () => {
    render(<BankClient accounts={[business, home]} loans={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "נבדקו" }));
    expect(screen.getAllByText("תקבול לקוח").length).toBeGreaterThan(0);
    expect(screen.queryByText("חשמל")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "לא נבדקו" }));
    fireEvent.click(box("חשמל"));
    fireEvent.click(box("שכר"));
    expect(screen.getByText("כל התנועות כאן נבדקו מול הבנק.")).toBeInTheDocument();
  });
});
