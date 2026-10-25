// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Editing one of a property's incomes in its currency (2026-10-23): a C$
// income on a Canada building is edited in C$, with the day's rate under it,
// and the route gets the C$ as typed.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
const committed = vi.hoisted(() => ({ patch: null as unknown }));
vi.mock("@/lib/undo-engine", () => ({
  scheduleDeferredEdit: async ({ patch, onCommit }: { patch: unknown; onCommit: () => Promise<unknown> }) => {
    committed.patch = patch;
    await onCommit();
  },
}));
vi.mock("@/components/financial/AccountSelect", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select aria-label="חשבון" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      <option value="acc-bank">מזרחי בית</option>
    </select>
  ),
}));
vi.mock("@/components/ui/dropdown-menu", () => import("@/__tests__/mocks/dropdown-menu"));
const lookupFxRate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({}) }));
vi.mock("@/lib/fx/rate-lookup", () => ({ lookupFxRate: (...args: unknown[]) => lookupFxRate(...args) }));

import PropertyIncomeEditDialog from "@/app/(app)/properties/[id]/PropertyIncomeEditDialog";
import type { PropertyPayment } from "@/lib/properties";

const income = {
  id: "pay-1",
  date: "2026-10-22",
  amount: 12100,
  method: "bank_transfer",
  dueDate: null,
  checkNumber: null,
  paymentStatus: "cleared",
  tornAt: null,
  rentAllocation: null,
  accountId: "acc-bank",
  notes: "החזר מהנוטריון",
  referenceNumber: null,
  requiresSplit: false,
  createdAt: null,
  leaseId: null,
  rentPeriodStart: null,
  rentPeriods: 1,
  countsAsRent: false,
  foreign: { currency: "CAD", amount: 5500, rate: 2.2, rateManual: false },
  attachments: [],
} as PropertyPayment;

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  lookupFxRate.mockReset();
  lookupFxRate.mockResolvedValue({ rate: 2.2, date: "2026-10-22" });
});
const sentBody = () => JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

describe("editing a property's income in its currency", () => {
  it("a C$ income: its C$ in the field, and the save sends the C$ as typed", async () => {
    render(<PropertyIncomeEditDialog payment={income} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "מטבע: דולר קנדי" })).toBeInTheDocument();
    const amount = screen.getAllByRole("textbox").find((el) => (el as HTMLInputElement).value === "5,500") as HTMLElement;
    expect(amount).toBeTruthy();
    expect(await screen.findByText(/שער יציג/)).toHaveTextContent("שער יציג 2.2 (22/10)");
    fireEvent.change(amount, { target: { value: "6000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody()).toMatchObject({ id: "pay-1", amount_total: 6000, currency: "CAD", fx_rate_manual: false });
    // On screen meanwhile: its shekels at the rate, and its C$.
    expect(committed.patch).toMatchObject({ amount: 13200, foreign: { currency: "CAD", amount: 6000, rate: 2.2 } });
  });

  it("a shekel income stays in shekels", async () => {
    render(<PropertyIncomeEditDialog payment={{ ...income, foreign: null }} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "מטבע: שקל" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody()).toMatchObject({ amount_total: 12100, currency: "ILS" });
    expect(committed.patch).toMatchObject({ amount: 12100, foreign: null });
  });
});
