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
vi.mock("@/app/(app)/financial/bank/QuickEntryRow", () => ({ default: () => null }));
vi.mock("@/components/financial/AccountTransferDialog", () => ({ AccountTransferDialog: () => null }));
vi.mock("@/components/financial/PaymentEditDialog", () => ({ PaymentEditDialog: () => null }));
vi.mock("@/components/payroll/EditWorkerPaymentDialog", () => ({ EditWorkerPaymentDialog: () => null }));
vi.mock("@/app/(app)/financial/loans/LoanDialogs", () => ({ EditPaidRepaymentDialog: () => null, LoanFormDialog: () => null }));
vi.mock("@/app/(app)/financial/loans/actions", () => ({ deleteLoan: vi.fn(), deleteRepayment: vi.fn() }));
vi.mock("@/lib/financial/cardChargesClient", () => ({ deleteCardCharge: vi.fn() }));
vi.mock("@/lib/financial/transfersClient", () => ({ deleteAccountTransfer: vi.fn() }));
vi.mock("@/lib/accounts/accountsClient", () => ({ saveAccountOrderDirect: vi.fn() }));

import BankClient from "@/app/(app)/financial/bank/BankClient";
import type { AccountLedgerEntry, AccountWithLedger } from "@/lib/accounts";

// Each register line says how its money moved — so it can be matched against
// the bank's statement (owner, 2026-10-25).

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

const bank = account({
  id: "acc1",
  name: "מזרחי עסקי",
  ledger: [
    row({ id: "p:1", label: "תקבול כהן", type: "in", amount: 500, method: "check", checkNumber: "1234" }),
    row({ id: "t:1:in", label: "העברה ממזומן", type: "in", amount: 2000, method: "cash" }),
    row({ id: "e:1", label: "חשמל", amount: 200, method: "bank_transfer" }),
    row({ id: "e:2", label: "ארנונה", amount: 80, method: null }),
  ],
});
const cash = account({
  id: "acc2",
  name: "קופה",
  kind: "cash",
  ledger: [
    row({ id: "e:5", label: "דלק", method: "cash" }),
    row({ id: "p:5", label: "צ׳ק בקופה", type: "in", method: "check" }),
  ],
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BankClient — how each line's money moved", () => {
  it("a check with its number, a cash deposit, a transfer; nothing for a line saved without one", () => {
    render(<BankClient accounts={[bank, cash]} loans={[]} />);
    expect(screen.getAllByText("צ'ק 1234").length).toBeGreaterThan(0);
    expect(screen.getAllByText("מזומן").length).toBeGreaterThan(0);
    expect(screen.getAllByText("העברה בנקאית").length).toBeGreaterThan(0);
    // ארנונה's line has its label and amount, and no method beside them.
    const line = screen.getAllByText("ארנונה")[0].parentElement!;
    expect(line.textContent).toBe("ארנונה");
  });

  it("in the cash box only what isn't cash is said", () => {
    render(<BankClient accounts={[bank, cash]} loans={[]} initialAccountId="acc2" />);
    expect(screen.getAllByText("דלק")[0].parentElement!.textContent).toBe("דלק");
    expect(screen.getAllByText("צ'ק").length).toBeGreaterThan(0);
  });

  it("a credit card's badge on its card in the strip is just אשראי, so its name has room", () => {
    const sapphire = account({ id: "acc3", name: "Sapphire Reserved", kind: "card" });
    render(<BankClient accounts={[bank, sapphire]} loans={[]} />);
    expect(screen.getByText("אשראי")).toBeInTheDocument();
    expect(screen.queryByText("כרטיס אשראי")).not.toBeInTheDocument();
  });

  it("the register's search finds lines by their method", async () => {
    render(<BankClient accounts={[bank, cash]} loans={[]} />);
    fireEvent.change(screen.getByRole("textbox", { name: "חיפוש בתנועות החשבונות" }), { target: { value: "צ'ק" } });
    await waitFor(() => expect(screen.getByText("נמצאה תנועה אחת במזרחי עסקי")).toBeInTheDocument());
    expect(screen.getAllByText("תקבול כהן").length).toBeGreaterThan(0);
    expect(screen.queryByText("חשמל")).not.toBeInTheDocument();
  });
});
