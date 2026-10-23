// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// A transfer between accounts in different currencies (owner, 2026-10-23):
// what left one, and what arrived in the other — the bank's rate is what the
// two came to.

const saveAccountTransfer = vi.fn();
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/financial/transfersClient", () => ({
  saveAccountTransfer: (...args: unknown[]) => saveAccountTransfer(...args),
  deleteAccountTransfer: vi.fn(),
}));
vi.mock("@/lib/undo-engine", () => ({ registerReversibleCreate: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({}) }));
vi.mock("@/lib/fx/rate-lookup", () => ({ lookupFxRate: vi.fn(async () => ({ rate: 3.107, date: "2026-10-22" })) }));

const accounts = [
  { id: "biz", name: "מזרחי עסקי", kind: "bank", currency: "ILS", openingBalance: 0, openingDate: "2026-07-01", isActive: true, sortOrder: 0, notes: null },
  { id: "chase", name: "Chase", kind: "bank", currency: "USD", openingBalance: 0, openingDate: "2026-07-01", isActive: true, sortOrder: 1, notes: null },
];
vi.mock("@/components/financial/AccountSelect", () => ({ loadAccounts: async () => accounts }));

import { AccountTransferDialog } from "@/components/financial/AccountTransferDialog";

beforeEach(() => {
  saveAccountTransfer.mockReset();
  saveAccountTransfer.mockResolvedValue({ ok: true, id: "t1" });
});

async function toAmountStep(fromName: string) {
  render(<AccountTransferDialog open onOpenChange={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(fromName) }));
  await screen.findByText("כמה יצא וכמה הגיע?");
}

describe("AccountTransferDialog — between currencies", () => {
  it("₪ into Chase: asks what left in shekels and what arrived in dollars, and says the rate", async () => {
    await toAmountStep("מזרחי עסקי");
    fireEvent.change(screen.getByRole("textbox", { name: "יצא" }), { target: { value: "3050" } });
    fireEvent.change(screen.getByRole("textbox", { name: "הגיע" }), { target: { value: "1000" } });
    expect(await screen.findByText("שער בפועל: $1 = ₪3.05 (שער יציג 3.107)")).toBeInTheDocument();
    for (const _ of [1, 2, 3]) fireEvent.click(screen.getByRole("button", { name: /המשך/ }));
    expect(screen.getByText("₪3,050")).toBeInTheDocument();
    expect(screen.getByText("$1,000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(saveAccountTransfer).toHaveBeenCalledTimes(1));
    expect(saveAccountTransfer.mock.calls[0][0]).toMatchObject({
      from_account_id: "biz",
      to_account_id: "chase",
      amount: 3050,
      from_amount: null,
      to_amount: 1000,
    });
  });

  it("Chase to ₪: the dollars that left and the shekels that arrived", async () => {
    await toAmountStep("Chase");
    fireEvent.change(screen.getByRole("textbox", { name: "יצא" }), { target: { value: "1000" } });
    fireEvent.change(screen.getByRole("textbox", { name: "הגיע" }), { target: { value: "3080" } });
    for (const _ of [1, 2, 3]) fireEvent.click(screen.getByRole("button", { name: /המשך/ }));
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(saveAccountTransfer).toHaveBeenCalledTimes(1));
    expect(saveAccountTransfer.mock.calls[0][0]).toMatchObject({ amount: 3080, from_amount: 1000, to_amount: null });
  });

  it("can't go on without what arrived", async () => {
    await toAmountStep("מזרחי עסקי");
    fireEvent.change(screen.getByRole("textbox", { name: "יצא" }), { target: { value: "3050" } });
    expect(screen.getByRole("button", { name: /המשך/ })).toBeDisabled();
  });
});
