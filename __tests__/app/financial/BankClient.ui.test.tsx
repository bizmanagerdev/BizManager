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
    // A shekel account's line moves its own amount.
    accountAmount: over.accountAmount ?? over.amount ?? 100,
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

// The page's checks (2026-10-28): nothing moves when a search starts, and an
// empty register says so in the app's own "nothing here" box.
describe("BankClient — searching and empty registers", () => {
  it("what a search found is said over the register — under the account strip, so the strip doesn't move", () => {
    render(<BankClient accounts={[business, home]} loans={[]} />);
    const strip = screen.getByRole("button", { name: /מזרחי עסקי/, pressed: true }).closest("div.flex.gap-2");
    fireEvent.change(screen.getByRole("textbox", { name: "חיפוש בתנועות החשבונות" }), { target: { value: "חשמל" } });
    const summary = screen.getByText("נמצאה תנועה אחת במזרחי עסקי").parentElement!;
    expect(strip).not.toBeNull();
    // The summary comes after the strip on the page, not between it and the search box.
    expect(strip!.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("an account with nothing on its register: the app's dashed \"nothing here\" box", () => {
    const empty = account({ id: "acc4", name: "חדש", ledger: [] });
    render(<BankClient accounts={[empty]} loans={[]} />);
    const message = screen.getByText(/אין תנועות משויכות לחשבון זה עדיין/);
    expect(message.closest(".border-dashed")).not.toBeNull();
  });
});

// An account kept in US$ (2026-10-23): read in dollars, as its statement is,
// with its shekels at today's rate; the total of the accounts in shekels.
describe("BankClient — an account in US$", () => {
  const usd = (amount: number, rate: number) => ({ currency: "USD" as const, amount, rate, rateManual: false });
  const chase = account({
    id: "chase",
    name: "Chase",
    currency: "USD",
    openingBalance: 1000,
    currentBalance: 1300,
    ledger: [
      row({ id: "e:1", label: "Home Depot", amount: 618.2, accountAmount: 200, foreign: usd(200, 3.091), runningBalance: 1300, date: "2025-01-04" }),
      row({ id: "p:1", label: "Zelle", type: "in", amount: 1553.5, accountAmount: 500, foreign: usd(500, 3.107), runningBalance: 1500, date: "2025-01-02" }),
    ],
  });
  const shekels = account({ id: "acc1", name: "מזרחי עסקי", currentBalance: 1000, ledger: [] });
  const fxRates = { USD: { rate: 3.107, date: "2026-10-22" } };

  it("its card shows dollars, and their shekels at today's rate; the total counts them so", () => {
    render(<BankClient accounts={[chase, shekels]} loans={[]} initialAccountId="chase" fxRates={fxRates} />);
    expect(screen.getAllByText("$1,300").length).toBeGreaterThan(0);
    expect(screen.getByText("≈ ₪4,039")).toBeInTheDocument();
    // סך נזילות: ₪1,000 + $1,300 × 3.107
    expect(screen.getAllByText("₪5,039").length).toBeGreaterThan(0);
    expect(screen.getByText(/כולל/)).toHaveTextContent("כולל $1,300 בשער $1 = ₪3.107 (22/10)");
  });

  it("its register: each line in dollars with its own day's shekels, the running balance and the opening in dollars", () => {
    render(<BankClient accounts={[chase, shekels]} loans={[]} initialAccountId="chase" fxRates={fxRates} />);
    expect(screen.getAllByText("+$500").length).toBeGreaterThan(0);
    expect(screen.getAllByText("≈ ₪1,554").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$1,500").length).toBeGreaterThan(0);
    expect(screen.getByText(/יתרת פתיחה/)).toHaveTextContent("יתרת פתיחה $1,000");
    expect(screen.getByText(/יתרת פתיחה/)).toHaveTextContent("שער יציג היום $1 = ₪3.107 (22/10)");
  });

  it("a tick on a dollar line is saved in dollars", async () => {
    render(<BankClient accounts={[chase, shekels]} loans={[]} initialAccountId="chase" fxRates={fxRates} />);
    fireEvent.click(box("Zelle"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ account_id: "chase", entry_key: "p:1", amount: 500 });
  });
});
