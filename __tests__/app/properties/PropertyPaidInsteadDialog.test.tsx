// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// A month paid another way than its check (owner, 2026-10-21): the transfer
// is that month's rent, and the check stays a check — its number and amount,
// still waiting — moved to the next month nothing pays yet.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
const committed = vi.hoisted(() => ({ patch: null as unknown, message: "" }));
vi.mock("@/lib/undo-engine", () => ({
  scheduleDeferredEdit: async ({ patch, message, onCommit }: { patch: unknown; message: string; onCommit: () => Promise<unknown> }) => {
    committed.patch = patch;
    committed.message = message;
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

import PropertyPaidInsteadDialog from "@/app/(app)/properties/[id]/PropertyPaidInsteadDialog";
import type { LeaseAgreement, PropertyPayment } from "@/lib/properties";

const lease = {
  id: "lease-d4",
  status: "active",
  startDate: "2026-03-19",
  endDate: "2027-06-06",
  monthlyRentAmount: 4000,
  rentCalendar: "hebrew",
  rentHebrewDay: 1,
  periodMonths: 1,
} as LeaseAgreement;

/** D4's checks: one per Hebrew month, חשון to אייר תשפ״ז. */
const MONTHS = ["2026-10-12", "2026-11-11", "2026-12-11", "2027-01-09", "2027-02-08", "2027-03-10", "2027-04-08", "2027-05-08"];
const checks = MONTHS.map(
  (start, i) =>
    ({
      id: `chk-${i}`,
      date: start,
      amount: 4000,
      method: "check",
      dueDate: start,
      checkNumber: String(261 + i),
      paymentStatus: i === 0 ? "cleared" : "pending",
      accountId: "acc-bank",
      notes: null,
      referenceNumber: null,
      requiresSplit: false,
      createdAt: null,
      leaseId: "lease-d4",
      rentPeriodStart: start,
      rentPeriods: 1,
      countsAsRent: true,
      attachments: [],
    }) as PropertyPayment
);

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
vi.stubGlobal("fetch", fetchMock);
const sent = () => fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body))]);

describe("a month paid by transfer instead of its check", () => {
  it("the transfer pays כסלו; check #262 stays a check, moved to סיון — the next month nothing pays", async () => {
    render(
      <PropertyPaidInsteadDialog check={checks[1]} lease={lease} payments={checks} propertyId="prop-d4" title="שכירות כסלו תשפ״ז" onClose={vi.fn()} />
    );
    expect(screen.getByText(/נשאר אצלנו ועובר ל/)).toHaveTextContent("צ׳ק #262 נשאר אצלנו ועובר לסיון תשפ״ז");
    fireEvent.change(screen.getByLabelText("חשבון"), { target: { value: "acc-bank" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    });
    const [[createUrl, created], [updateUrl, moved]] = sent();
    expect(createUrl).toBe("/api/payments/create");
    expect(created).toMatchObject({
      property_id: "prop-d4",
      payment_method: "bank_transfer",
      amount_total: 4000,
      account_id: "acc-bank",
      lease_id: "lease-d4",
      rent_period_start: "2026-11-11",
      rent_periods: 1,
    });
    expect(updateUrl).toBe("/api/payments/update");
    expect(moved).toMatchObject({
      id: "chk-1",
      payment_method: "check",
      check_number: "262",
      amount_total: 4000,
      due_date: "2027-06-06",
      rent_period_start: "2027-06-06",
    });
    expect(committed.message).toContain("הצ׳ק עבר לסיון תשפ״ז");
  });
});
