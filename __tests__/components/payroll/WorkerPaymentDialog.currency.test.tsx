// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// A worker paid in dollars (owner, 2026-10-25: "it needs to reduce that amount
// of shekel from the worker's owed amount"): the amount is typed in $, and its
// shekels at the day's rate are what come off what he's owed.

const toastInfo = vi.fn();
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: (...args: unknown[]) => toastInfo(...args) } }));
vi.mock("@/components/ui/dropdown-menu", () => import("@/__tests__/mocks/dropdown-menu"));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({}) }));
vi.mock("@/lib/fx/rate-lookup", () => ({ lookupFxRate: vi.fn(async () => ({ rate: 3.11, date: "2026-10-22" })) }));

const accounts = [
  { id: "biz", name: "מזרחי עסקי", kind: "bank", currency: "ILS", openingBalance: 0, openingDate: "2026-07-01", isActive: true, sortOrder: 0, notes: null },
  { id: "chase", name: "Chase", kind: "bank", currency: "USD", openingBalance: 0, openingDate: "2026-07-01", isActive: true, sortOrder: 1, notes: null },
];
vi.mock("@/components/financial/AccountSelect", () => ({ loadAccounts: async () => accounts }));

import { WorkerPaymentDialog } from "@/components/payroll/WorkerPaymentDialog";

const DEBT = [
  {
    source_type: "payslip",
    source_id: "ps-1",
    user_id: "u1",
    payment_status: "unpaid",
    source_date: "2026-09-30",
    earned_amount: 3110,
    paid_amount: 0,
    owed_amount: 3110,
  },
];

const fetchMock = vi.fn();

beforeEach(() => {
  toastInfo.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("/api/payroll/worker-debt")) {
      return new Response(JSON.stringify({ workerDebtItems: DEBT }), { status: 200 });
    }
    if (String(url) === "/api/payroll/worker-payments" && init?.method === "POST") {
      return new Response(JSON.stringify({ payment: { id: "wp-1" } }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function amountField() {
  return screen.getByRole("textbox") as HTMLInputElement;
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: /המשך/ }));
}

async function toAmountStep() {
  render(
    <WorkerPaymentDialog
      open
      onOpenChange={() => {}}
      users={[{ id: "u1", label: "סלאח", role: "worker" } as never]}
      currentUserRole="admin"
      onSaved={() => {}}
    />
  );
  fireEvent.click(await screen.findByRole("button", { name: /סלאח/ }));
  await screen.findByText("על איזה סכום?");
  // The open balance fills the amount, in shekels.
  await waitFor(() => expect(amountField().value).toBe("3,110"));
}

function choose(symbol: string) {
  fireEvent.click(screen.getByRole("button", { name: /^מטבע: / }));
  const item = screen.getAllByRole("menuitem").find((el) => el.querySelector("span")?.textContent === symbol);
  fireEvent.click(item!);
}

async function saveFrom(accountName: string) {
  next(); // date
  next(); // method
  fireEvent.click(screen.getByRole("button", { name: /מזומן/ }));
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(accountName) }));
  // An account kept in dollars brings its day's rate a moment later.
  await act(async () => {});
  next(); // reference
  next(); // notes
  fireEvent.click(screen.getByRole("button", { name: "שמירת תשלום" }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => u === "/api/payroll/worker-payments" && i?.method === "POST")).toBe(true));
  const [, init] = fetchMock.mock.calls.find(([u, i]) => u === "/api/payroll/worker-payments" && i?.method === "POST")!;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("WorkerPaymentDialog — in dollars", () => {
  it("the sign turned to $: the balance it fills in follows, and its shekels are what's allocated", async () => {
    await toAmountStep();
    choose("$");
    await waitFor(() => expect(amountField().value).toBe("1,000"));
    expect(screen.getByText(/≈ \$1,000/)).toBeInTheDocument();
    const body = await saveFrom("מזרחי עסקי");
    expect(body).toMatchObject({
      amount: 1000,
      currency: "USD",
      fx_rate_manual: false,
      account_id: "biz",
      allocations: [{ source_type: "payslip", source_id: "ps-1", amount: 3110 }],
    });
  });

  it("paid out of Chase: the amount filled in turns to dollars by itself", async () => {
    await toAmountStep();
    const body = await saveFrom("Chase");
    expect(toastInfo).not.toHaveBeenCalled();
    expect(body).toMatchObject({ amount: 1000, currency: "USD", account_id: "chase" });
  });

  it("an amount typed in shekels, then Chase: back to the amount to check it", async () => {
    await toAmountStep();
    fireEvent.change(amountField(), { target: { value: "1500" } });
    next();
    next();
    fireEvent.click(screen.getByRole("button", { name: /מזומן/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Chase/ }));
    expect(toastInfo).toHaveBeenCalledWith("החשבון מתנהל בדולר — יש לבדוק את הסכום");
    expect(await screen.findByText("על איזה סכום?")).toBeInTheDocument();
  });

  it("in shekels as before: the amount and its allocation are shekels", async () => {
    await toAmountStep();
    const body = await saveFrom("מזרחי עסקי");
    expect(body).toMatchObject({ amount: 3110, currency: "ILS", allocations: [{ amount: 3110 }] });
  });
});
