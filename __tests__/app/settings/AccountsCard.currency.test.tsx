// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// ניהול חשבונות: an account's currency (owner, 2026-10-23: Chase is in
// dollars) — its opening balance is typed and shown in it.

const saveAccountDirect = vi.fn();
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/accounts/accountsClient", () => ({
  fetchAccountsDirect: vi.fn(async () => []),
  saveAccountDirect: (...args: unknown[]) => saveAccountDirect(...args),
  deleteAccountDirect: vi.fn(),
}));
vi.mock("@/components/financial/AccountSelect", () => ({ invalidateAccountsCache: vi.fn() }));
vi.mock("@/lib/undo-engine", () => ({
  scheduleDeferredAction: ({ onApplyOptimistic, onCommit }: { onApplyOptimistic: () => void; onCommit: () => Promise<unknown> }) => {
    onApplyOptimistic();
    void onCommit();
  },
  registerReversibleAction: vi.fn(),
}));

import AccountsCard from "@/app/(app)/settings/AccountsCard";
import type { Account } from "@/lib/accounts";

const chase: Account = {
  id: "chase",
  name: "Chase",
  kind: "bank",
  currency: "USD",
  openingBalance: 1000,
  openingDate: "2026-07-01",
  isActive: true,
  sortOrder: 0,
  notes: null,
  accountNumber: null,
};

beforeEach(() => {
  saveAccountDirect.mockReset();
  saveAccountDirect.mockResolvedValue({ ok: true });
});

describe("AccountsCard — an account's currency", () => {
  it("lists a dollar account with its currency and its opening balance in dollars", () => {
    render(<AccountsCard initialAccounts={[chase]} />);
    expect(screen.getByText("דולר")).toBeInTheDocument();
    expect(screen.getByText("$1,000")).toBeInTheDocument();
  });

  it("its form has the currency, the opening balance marked in it, and saves it", async () => {
    render(<AccountsCard initialAccounts={[chase]} />);
    fireEvent.click(screen.getByRole("button", { name: /עריכה/ }));
    expect(screen.getByRole("button", { name: "$ דולר" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("אפשר לשנות את המטבע רק כשאין בחשבון תנועות במטבע אחר.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "C$ דולר קנדי" }));
    expect(screen.getByText("C$")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(saveAccountDirect).toHaveBeenCalledTimes(1));
    expect(saveAccountDirect.mock.calls[0][0]).toMatchObject({ id: "chase", currency: "CAD", opening_balance: 1000 });
  });
});
