// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// A month paid another way than its check (owner, 2026-10-22): what came
// instead is that month's rent — one payment or several ("1000 cash and a 1000
// transfer and 1000 a transfer to another account") — and the check is torn:
// kept, counting nowhere, and it can be brought back.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
const { toast } = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("sonner", () => ({ toast }));
const committed = vi.hoisted(() => ({ patch: null as unknown, message: "" }));
vi.mock("@/lib/undo-engine", () => ({
  scheduleDeferredEdit: async ({
    patch,
    message,
    onCommit,
  }: {
    patch: unknown;
    message: string;
    onCommit: () => Promise<unknown>;
  }) => {
    committed.patch = patch;
    committed.message = message;
    await onCommit();
  },
}));
vi.mock("@/components/financial/AccountSelect", () => ({
  loadAccounts: async () => [
    { id: "acc-bank", name: "מזרחי בית", kind: "bank", isActive: true },
    { id: "acc-leumi", name: "לאומי", kind: "bank", isActive: true },
    { id: "acc-cash", name: "קופה", kind: "cash", isActive: true },
  ],
}));
vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: ({
    ariaLabel,
    value,
    onChange,
    options,
  }: {
    ariaLabel: string;
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
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
      tornAt: null,
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
    }) as PropertyPayment,
);

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
vi.stubGlobal("fetch", fetchMock);
const sent = () => fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body))]);

afterEach(cleanup);
beforeEach(() => {
  fetchMock.mockClear();
  toast.error.mockClear();
});

async function open(onRecorded = vi.fn()) {
  await act(async () => {
    render(
      <PropertyPaidInsteadDialog
        check={checks[1]}
        lease={lease}
        propertyId="prop-d4"
        title="שכירות כסלו תשפ״ז"
        onClose={vi.fn()}
        onRecorded={onRecorded}
      />,
    );
  });
  return onRecorded;
}

/** Fills payment line n (from 1): how much, how, into which account. */
function fill(n: number, amount: string, method: string, account: string) {
  const line = screen.getByRole("group", { name: `תשלום ${n}` });
  fireEvent.change(within(line).getByRole("textbox", { name: "סכום" }), { target: { value: amount } });
  fireEvent.change(within(line).getByRole("combobox", { name: "איך שולם" }), { target: { value: method } });
  fireEvent.change(within(line).getByRole("combobox", { name: "חשבון" }), { target: { value: account } });
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
  });
}

describe("a month paid another way than its check", () => {
  it("one transfer for the whole month: it pays כסלו, and check #262 is torn", async () => {
    await open();
    expect(screen.getByText(/נקרע — לא ייפרע/)).toHaveTextContent("צ׳ק #262 נקרע — לא ייפרע ולא נספר בשום מקום");
    // The one line starts at the check's amount, by transfer.
    expect(screen.getByRole("textbox", { name: "סכום" })).toHaveValue("4,000");
    fireEvent.change(screen.getByRole("combobox", { name: "חשבון" }), { target: { value: "acc-bank" } });
    await save();
    const [[createUrl, created], [tornUrl, torn]] = sent();
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
    // The check isn't moved to another month any more (owner, 2026-10-22: "it's wrong — the check just disappears").
    expect(tornUrl).toBe("/api/payments/mark-collected");
    expect(torn).toEqual({ id: "chk-1", torn: true });
    expect(committed.patch).toMatchObject({ paymentStatus: "rejected" });
    expect(committed.message).toBe("נרשם: שולם בהעברה בנקאית. צ׳ק #262 נקרע.");
  });

  it("₪1,000 cash, ₪1,000 by transfer and ₪1,000 by transfer to another account: three payments, the check torn, ₪1,000 still owed", async () => {
    const onRecorded = await open();
    fireEvent.click(screen.getByRole("button", { name: "עוד תשלום" }));
    fireEvent.click(screen.getByRole("button", { name: "עוד תשלום" }));
    fill(1, "1000", "cash", "acc-cash");
    fill(2, "1000", "bank_transfer", "acc-bank");
    fill(3, "1000", "bank_transfer", "acc-leumi");
    expect(screen.getByText(/^סה״כ/)).toHaveTextContent("סה״כ ₪3,000 מתוך ₪4,000 · חסר ₪1,000");
    await save();
    const calls = sent();
    expect(calls.map(([url]) => url)).toEqual([
      "/api/payments/create",
      "/api/payments/create",
      "/api/payments/create",
      "/api/payments/mark-collected",
    ]);
    expect(
      calls.slice(0, 3).map(([, body]) => [body.amount_total, body.payment_method, body.account_id, body.rent_period_start]),
    ).toEqual([
      [1000, "cash", "acc-cash", "2026-11-11"],
      [1000, "bank_transfer", "acc-bank", "2026-11-11"],
      [1000, "bank_transfer", "acc-leumi", "2026-11-11"],
    ]);
    expect(calls[3][1]).toEqual({ id: "chk-1", torn: true });
    expect(committed.message).toBe("נרשמו 3 תשלומים. צ׳ק #262 נקרע. חסר ₪1,000.");
    // Shown at once on the rent page, each its own payment.
    expect(onRecorded.mock.calls.map(([p]) => [p.id, p.amount, p.method])).toEqual([
      ["instead:chk-1#0", 1000, "cash"],
      ["instead:chk-1#1", 1000, "bank_transfer"],
      ["instead:chk-1#2", 1000, "bank_transfer"],
    ]);
  });

  it("a new line starts with what's still missing, and a line can be taken off", async () => {
    await open();
    fill(1, "1500", "cash", "acc-cash");
    fireEvent.click(screen.getByRole("button", { name: "עוד תשלום" }));
    const second = screen.getByRole("group", { name: "תשלום 2" });
    expect(within(second).getByRole("textbox", { name: "סכום" })).toHaveValue("2,500");
    fireEvent.click(within(second).getByRole("button", { name: "הסרת התשלום" }));
    expect(screen.queryByRole("group", { name: "תשלום 2" })).toBeNull();
    expect(screen.getAllByRole("textbox", { name: "סכום" })).toHaveLength(1);
  });

  it("more than the check: nothing is saved", async () => {
    await open();
    fill(1, "3000", "cash", "acc-cash");
    fireEvent.click(screen.getByRole("button", { name: "עוד תשלום" }));
    fill(2, "1500", "bank_transfer", "acc-bank");
    expect(screen.getByText(/^סה״כ/)).toHaveTextContent("יותר ב־₪500");
    await save();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("סכום התשלומים גבוה מצ׳ק #262 (₪4,000).");
  });
});
