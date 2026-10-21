// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// A due rent check that cleared (owner, 2026-10-21): into which account,
// really — the one it was recorded with unless changed.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
// The save commits at once here (the real one waits out its undo).
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
      <option value="acc-other">פועלים</option>
    </select>
  ),
}));

import PropertyCheckArrivedDialog from "@/app/(app)/properties/[id]/PropertyCheckArrivedDialog";
import type { PropertyPayment } from "@/lib/properties";

const check = {
  id: "pay-262",
  date: "2026-11-11",
  amount: 4000,
  method: "check",
  dueDate: "2026-11-11",
  checkNumber: "262",
  paymentStatus: "pending",
  accountId: "acc-bank",
  notes: null,
  referenceNumber: null,
  requiresSplit: false,
  createdAt: null,
  leaseId: "lease-d4",
  rentPeriodStart: "2026-11-11",
  rentPeriods: 1,
  countsAsRent: true,
  attachments: [],
} as PropertyPayment;

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
const sent = () => fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body))]);

describe("a due rent check that cleared", () => {
  it("the check cleared — into the account it really went to", async () => {
    render(<PropertyCheckArrivedDialog payment={check} title="שכירות כסלו תשפ״ז" onClose={vi.fn()} />);
    expect(screen.getByText("הצ׳ק נפרע", { selector: "h2" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("חשבון"), { target: { value: "acc-other" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    });
    expect(sent()).toEqual([["/api/payments/mark-collected", { id: "pay-262", collected: true, account_id: "acc-other" }]]);
    expect(committed.patch).toEqual({ paymentStatus: "cleared", accountId: "acc-other" });
  });
});
