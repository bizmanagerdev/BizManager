// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// Recording rent (owner, 2026-10-22): the months ticked one by one, ahead or
// back ("I choose what months it will cover"), the money filling them oldest
// first; one payment or several ("1000 cash and a 1000 transfer and 1000 a
// transfer to another account"); a ticked month's waiting check torn — or, if
// it's the check itself that came in, marked cleared instead.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
const { toast } = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("sonner", () => ({ toast }));
const undo = vi.hoisted(() => ({ message: "" }));
vi.mock("@/lib/undo-engine", () => ({
  registerReversibleCreate: ({ message }: { message: string }) => {
    undo.message = message;
  },
}));
const sent = vi.hoisted(() => [] as Array<[string, Record<string, unknown>]>);
vi.mock("@/lib/offline-queue", () => ({
  offlineFetch: async (url: string, body: Record<string, unknown>) => {
    sent.push([url, body]);
    return { ok: true, data: { payment: { id: crypto.randomUUID() } } };
  },
}));
vi.mock("@/lib/payments/uploadCheckPhotos", () => ({ queueFinancialAttachmentsAfter: vi.fn() }));
vi.mock("@/app/(app)/dashboard/DashboardActions.helpers", () => ({ uploadFinancialAttachment: vi.fn() }));
vi.mock("@/components/financial/AccountSelect", () => ({
  loadAccounts: async () => [
    { id: "acc-bank", name: "מזרחי בית", kind: "bank", isActive: true },
    { id: "acc-leumi", name: "לאומי", kind: "bank", isActive: true },
    { id: "acc-cash", name: "קופה", kind: "cash", isActive: true },
    { id: "acc-chase", name: "Chase", kind: "bank", currency: "USD", isActive: true },
  ],
}));
// A payment in US$ / C$: the sign opens the currency; the day's rate is 3.112.
vi.mock("@/components/ui/dropdown-menu", () => import("@/__tests__/mocks/dropdown-menu"));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({}) }));
vi.mock("@/lib/fx/rate-lookup", () => ({ lookupFxRate: async () => ({ rate: 3.112, date: "2026-10-21" }) }));
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

import PropertyRentPaymentDialog from "@/app/(app)/properties/[id]/PropertyRentPaymentDialog";
import type { LeaseAgreement, PropertyPayment } from "@/lib/properties";

const HEBREW = {
  id: "lease-d4",
  status: "active",
  startDate: "2026-03-19",
  endDate: "2027-06-06",
  monthlyRentAmount: 4000,
  rentCalendar: "hebrew",
  rentHebrewDay: 1,
  periodMonths: 1,
  customerName: "רוזנפלד",
} as LeaseAgreement;
const REGULAR = {
  id: "lease-y15",
  status: "active",
  startDate: "2026-09-01",
  endDate: "2027-05-31",
  monthlyRentAmount: 4000,
  rentCalendar: "gregorian",
  rentDayOfMonth: 1,
  periodMonths: 1,
  customerName: "כהן",
} as LeaseAgreement;

function payment(id: string, extra: Partial<PropertyPayment>): PropertyPayment {
  return {
    id,
    date: "2026-10-01",
    amount: 4000,
    method: "bank_transfer",
    dueDate: null,
    checkNumber: null,
    paymentStatus: "cleared",
    tornAt: null,
    accountId: "acc-bank",
    notes: null,
    referenceNumber: null,
    requiresSplit: false,
    createdAt: null,
    leaseId: "lease-d4",
    rentPeriodStart: null,
    rentPeriods: 1,
    rentAllocation: null,
    countsAsRent: true,
    attachments: [],
    ...extra,
  };
}

/** D4's checks: חשון (cleared, unless told otherwise) and כסלו–טבת, waiting. */
const d4Checks = (heshvan = "cleared") => [
  payment("chk-0", { method: "check", checkNumber: "261", date: "2026-10-12", dueDate: "2026-10-12", paymentStatus: heshvan, rentPeriodStart: "2026-10-12" }),
  payment("chk-1", { method: "check", checkNumber: "262", date: "2026-11-11", dueDate: "2026-11-11", paymentStatus: "pending", rentPeriodStart: "2026-11-11" }),
  payment("chk-2", { method: "check", checkNumber: "263", date: "2026-12-11", dueDate: "2026-12-11", paymentStatus: "pending", rentPeriodStart: "2026-12-11" }),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T09:00:00Z"));
  sent.length = 0;
  undo.message = "";
  toast.error.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function open(props: Partial<Parameters<typeof PropertyRentPaymentDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  await act(async () => {
    render(
      <PropertyRentPaymentDialog
        open
        onOpenChange={onOpenChange}
        propertyId="prop-d4"
        lease={HEBREW}
        payments={d4Checks()}
        {...props}
      />
    );
  });
  return onOpenChange;
}

/** Fills payment line n (from 1): how much, how, into which account. */
function fill(n: number, amount: string, method: string, account: string) {
  const line = screen.getByRole("group", { name: `תשלום ${n}` });
  fireEvent.change(within(line).getByRole("textbox", { name: "סכום" }), { target: { value: amount } });
  fireEvent.change(within(line).getByRole("combobox", { name: "איך שולם" }), { target: { value: method } });
  fireEvent.change(within(line).getByRole("combobox", { name: "חשבון" }), { target: { value: account } });
}
const month = (label: RegExp) => screen.getByRole("button", { name: label });
async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
  });
}

describe("רישום תשלום — the months ticked, the money into them", () => {
  it("כסלו paid by transfer though its check waits: the month ticked, a transfer for ₪4,000, check #262 torn with it", async () => {
    await open({ prefill: { periodStart: "2026-11-11", method: "check", accountId: "acc-bank" } });
    expect(month(/^כסלו תשפ״ז/)).toHaveAttribute("aria-pressed", "true");
    // What comes instead of a waiting check is rarely another check.
    expect(screen.getByRole("combobox", { name: "איך שולם" })).toHaveValue("bank_transfer");
    expect(screen.getByRole("textbox", { name: "סכום" })).toHaveValue("4,000");
    expect(screen.getByRole("checkbox", { name: /לקרוע את צ׳ק #262/ })).toBeChecked();
    fireEvent.change(screen.getByRole("combobox", { name: "חשבון" }), { target: { value: "acc-bank" } });
    await save();
    expect(sent.map(([url]) => url)).toEqual(["/api/payments/create", "/api/payments/mark-collected"]);
    expect(sent[0][1]).toMatchObject({
      payment_method: "bank_transfer",
      amount_total: 4000,
      account_id: "acc-bank",
      lease_id: "lease-d4",
      rent_allocation: [{ period: "2026-11-11", amount: 4000 }],
    });
    expect(sent[1][1]).toEqual({ id: "chk-1", torn: true });
    expect(undo.message).toBe("נרשם תשלום שכירות לכסלו תשפ״ז. צ׳ק #262 נקרע.");
  });

  it("₪1,000 cash, ₪1,000 by transfer and ₪1,000 to another account for כסלו: three payments, the check torn, ₪1,000 still owed", async () => {
    await open({ prefill: { periodStart: "2026-11-11" } });
    fireEvent.click(screen.getByRole("button", { name: "עוד תשלום" }));
    fireEvent.click(screen.getByRole("button", { name: "עוד תשלום" }));
    fill(1, "1000", "cash", "acc-cash");
    fill(2, "1000", "bank_transfer", "acc-bank");
    fill(3, "1000", "bank_transfer", "acc-leumi");
    expect(screen.getByText(/^סה״כ/)).toHaveTextContent("סה״כ ₪3,000 · לכסלו תשפ״ז · חסר ₪1,000");
    await save();
    const creates = sent.filter(([url]) => url === "/api/payments/create").map(([, b]) => [b.amount_total, b.payment_method, b.account_id, b.rent_allocation]);
    expect(creates).toEqual([
      [1000, "cash", "acc-cash", [{ period: "2026-11-11", amount: 1000 }]],
      [1000, "bank_transfer", "acc-bank", [{ period: "2026-11-11", amount: 1000 }]],
      [1000, "bank_transfer", "acc-leumi", [{ period: "2026-11-11", amount: 1000 }]],
    ]);
    expect(sent.at(-1)).toEqual(["/api/payments/mark-collected", { id: "chk-1", torn: true }]);
    expect(undo.message).toBe("נרשמו 3 תשלומים לכסלו תשפ״ז. צ׳ק #262 נקרע. חסר ₪1,000.");
  });

  it("back and ahead in one transfer: the rest of ספטמבר, then נובמבר and דצמבר — אוקטובר, paid, skipped; ₪7,000 leaves דצמבר ₪2,000 short", async () => {
    await open({
      lease: REGULAR,
      payments: [
        payment("sep", { leaseId: "lease-y15", amount: 3000, rentPeriodStart: "2026-09-01" }),
        payment("oct", { leaseId: "lease-y15", rentPeriodStart: "2026-10-01" }),
      ],
      prefill: { periodStart: "2026-09-01" },
    });
    expect(month(/^ספטמבר 2026/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "סכום" })).toHaveValue("1,000");
    expect(month(/^אוקטובר/)).toBeDisabled();
    fireEvent.click(month(/^נובמבר/));
    fireEvent.click(month(/^דצמבר/));
    // The amount follows the months until it's typed.
    expect(screen.getByRole("textbox", { name: "סכום" })).toHaveValue("9,000");
    fill(1, "7000", "bank_transfer", "acc-bank");
    expect(month(/^דצמבר/)).toHaveAccessibleName(/₪2,000 · חסר ₪2,000/);
    expect(screen.getByText(/^סה״כ/)).toHaveTextContent("סה״כ ₪7,000 · לספטמבר, נובמבר – דצמבר 2026 · חסר ₪2,000");
    await save();
    expect(sent).toHaveLength(1);
    expect(sent[0][1].rent_allocation).toEqual([
      { period: "2026-09-01", amount: 1000 },
      { period: "2026-11-01", amount: 4000 },
      { period: "2026-12-01", amount: 2000 },
    ]);
    expect(undo.message).toBe("נרשם תשלום שכירות לספטמבר, נובמבר – דצמבר 2026. חסר ₪2,000.");
  });

  it("more than the months ticked need: nothing is saved", async () => {
    await open({ prefill: { periodStart: "2026-11-11" } });
    fill(1, "4500", "bank_transfer", "acc-bank");
    expect(screen.getByText(/^סה״כ/)).toHaveTextContent("יותר ב־₪500");
    await save();
    expect(sent).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith("הסכום גבוה ב־₪500 ממה שהחודשים שסומנו צריכים — אפשר לסמן עוד חודש.");
  });

  it("a check kept (its box unticked): its month needs nothing more, and it isn't torn", async () => {
    await open({ prefill: { periodStart: "2026-11-11" } });
    fireEvent.click(month(/^טבת/));
    fireEvent.click(screen.getByRole("checkbox", { name: /לקרוע את צ׳ק #262/ }));
    // כסלו's check stays: only טבת is paid — and its check torn.
    expect(screen.getByRole("textbox", { name: "סכום" })).toHaveValue("4,000");
    fireEvent.change(screen.getByRole("combobox", { name: "חשבון" }), { target: { value: "acc-bank" } });
    await save();
    expect(sent[0][1].rent_allocation).toEqual([{ period: "2026-12-11", amount: 4000 }]);
    expect(sent.slice(1)).toEqual([["/api/payments/mark-collected", { id: "chk-2", torn: true }]]);
  });

  it("the month's check is already due: 'הופקד?' — marking it cleared instead closes this", async () => {
    const onCheckCleared = vi.fn();
    const onOpenChange = await open({ payments: d4Checks("pending"), prefill: { periodStart: "2026-10-12" }, onCheckCleared });
    expect(screen.getByText(/שממתין לפירעון/)).toHaveTextContent("יש צ׳ק #261 שממתין לפירעון ב־12/10/26. הוא הופקד?");
    fireEvent.click(screen.getByRole("button", { name: "סימון כנפרע" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCheckCleared).toHaveBeenCalledWith(expect.objectContaining({ id: "chk-0" }));
    expect(sent).toEqual([]);
  });
});

// Rent stays in shekels; a tenant can pay in dollars (owner, 2026-10-25): the
// payment's shekels, at its day's rate, are what fill the months.
describe("רישום תשלום — paid in dollars", () => {
  function chooseCurrency(symbol: string) {
    fireEvent.click(screen.getByRole("button", { name: /^מטבע: / }));
    const item = screen.getAllByRole("menuitem").find((el) => el.querySelector("span")?.textContent === symbol);
    fireEvent.click(item!);
  }

  it("₪4,000 for כסלו paid in $: the amount follows in dollars, its shekels fill the month", async () => {
    await open({ prefill: { periodStart: "2026-11-11" } });
    chooseCurrency("$");
    await act(async () => {});
    expect(screen.getByRole("textbox", { name: "סכום" })).toHaveValue("1,285.35");
    fireEvent.change(screen.getByRole("combobox", { name: "חשבון" }), { target: { value: "acc-bank" } });
    expect(screen.getByText(/^סה״כ/)).toHaveTextContent("סה״כ ₪4,000.01 ($1,285.35) · לכסלו תשפ״ז");
    await save();
    expect(sent[0][1]).toMatchObject({
      amount_total: 1285.35,
      currency: "USD",
      fx_rate_manual: false,
      account_id: "acc-bank",
      rent_allocation: [{ period: "2026-11-11", amount: 4000.01 }],
    });
  });

  it("paid into Chase: the line turns to dollars by itself", async () => {
    await open({ prefill: { periodStart: "2026-11-11" } });
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: "חשבון" }), { target: { value: "acc-chase" } });
    });
    await act(async () => {});
    expect(screen.getByRole("textbox", { name: "סכום" })).toHaveValue("1,285.35");
    expect(screen.getByText("החשבון מתנהל בדולר.")).toBeInTheDocument();
    await save();
    expect(sent[0][1]).toMatchObject({ amount_total: 1285.35, currency: "USD", account_id: "acc-chase" });
  });
});
