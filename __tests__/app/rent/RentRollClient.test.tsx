// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

// The rent roll (owner, 2026-10-21): on a computer a plain table — what it is,
// paid or not, when, how, into which account, the check and its photo — the
// rent marked from its row, and a filter for who still owes this month.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
const dialog = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("@/app/(app)/properties/[id]/PropertyRentPaymentDialog", () => ({
  default: (props: Record<string, unknown>) => {
    dialog.props = props;
    if (!props.open) return null;
    const lease = props.lease as { id: string };
    const prefill = props.prefill as { periodStart: string };
    return (
      <button
        type="button"
        onClick={() => {
          (props.onRecorded as (p: unknown) => void)({
            id: "new-pay",
            date: "2026-10-21",
            amount: 8500,
            method: "bank_transfer",
            dueDate: null,
            checkNumber: null,
            paymentStatus: "cleared",
            accountId: "a1",
            notes: null,
            referenceNumber: null,
            requiresSplit: false,
            createdAt: null,
            leaseId: lease.id,
            rentPeriodStart: prefill.periodStart,
            rentPeriods: 1,
            countsAsRent: true,
            attachments: [],
          });
          (props.onOpenChange as (open: boolean) => void)(false);
        }}
      >
        שמירה (מדומה)
      </button>
    );
  },
}));
vi.mock("@/app/(app)/properties/[id]/PropertyCheckArrivedDialog", () => ({ default: () => null }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));
// The row's ⋮ as a plain open/close list (Radix needs real pointer events).
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  type Children = { children?: React.ReactNode };
  const Menu = React.createContext<{ open: boolean; setOpen: (open: boolean) => void }>({ open: false, setOpen: () => {} });
  return {
    DropdownMenu: ({ children }: Children) => {
      const [open, setOpen] = React.useState(false);
      return <Menu.Provider value={{ open, setOpen }}>{children}</Menu.Provider>;
    },
    DropdownMenuTrigger: ({ children }: Children) => {
      const { open, setOpen } = React.useContext(Menu);
      return React.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, { onClick: () => setOpen(!open) });
    },
    DropdownMenuContent: ({ children }: Children) => (React.useContext(Menu).open ? <div role="menu">{children}</div> : null),
    DropdownMenuItem: ({ children, onClick }: Children & { onClick?: () => void }) => (
      <div role="menuitem" onClick={() => onClick?.()}>
        {children}
      </div>
    ),
  };
});
vi.mock("@/app/(app)/properties/[id]/PropertyPaidInsteadDialog", () => ({ default: () => null }));

import RentRollClient from "@/app/(app)/rent/RentRollClient";
import type { LeaseAgreement, RentRollData, RentRollPayment } from "@/lib/properties";

const CHECK_ID = "11111111-1111-4111-8111-111111111111";
const OLD_ID = "22222222-2222-4222-8222-222222222222";

function lease(extra: Partial<LeaseAgreement>): LeaseAgreement {
  return {
    id: "",
    propertyId: "",
    customerId: "",
    customerName: null,
    customerPhone: null,
    startDate: "2026-06-01",
    endDate: null,
    monthlyRentAmount: 4000,
    documentId: null,
    documentFileName: null,
    documentUrl: null,
    status: "active",
    notes: null,
    depositType: null,
    depositAmount: null,
    depositReference: null,
    keysHandedOver: null,
    rentDayOfMonth: 1,
    rentCalendar: "gregorian",
    rentHebrewDay: null,
    periodMonths: 1,
    areaSqm: null,
    unitLabel: null,
    createdAt: null,
    ...extra,
  };
}

function payment(extra: Partial<RentRollPayment>): RentRollPayment {
  return {
    id: "",
    propertyId: "",
    date: null,
    amount: 0,
    method: "bank_transfer",
    dueDate: null,
    checkNumber: null,
    paymentStatus: "cleared",
    accountId: null,
    notes: null,
    referenceNumber: null,
    requiresSplit: false,
    createdAt: null,
    leaseId: null,
    rentPeriodStart: null,
    rentPeriods: 1,
    countsAsRent: true,
    attachments: [],
    ...extra,
  };
}

const DATA: RentRollData = {
  properties: [
    { id: "p-yehuda", name: "יהודה הנשיא 15", address: "", propertyType: "apartment", isActive: true, sortOrder: 1 },
    { id: "p-d4", name: "D4 הר יונה", address: "", propertyType: "apartment", isActive: true, sortOrder: 2 },
  ],
  leases: [
    lease({ id: "l-yehuda", propertyId: "p-yehuda", customerName: "ווגשל", monthlyRentAmount: 8500, startDate: "2026-09-01", endDate: "2026-12-15" }),
    lease({
      id: "l-d4", propertyId: "p-d4", customerName: "רוזנפלד", startDate: "2026-10-12", rentCalendar: "hebrew", rentHebrewDay: 1, rentDayOfMonth: null,
      depositType: "security_check", depositAmount: 8000,
    }),
  ],
  payments: [
    // D4's חשון: check #261, cleared into מזרחי בית. September, months before, unpaid — never shown here.
    payment({ id: CHECK_ID, propertyId: "p-d4", leaseId: "l-d4", date: "2026-10-12", dueDate: "2026-10-12", amount: 4000, method: "check", checkNumber: "261", accountId: "a1", rentPeriodStart: "2026-10-12" }),
    // יהודה הנשיא: September paid; October not yet.
    payment({ id: OLD_ID, propertyId: "p-yehuda", leaseId: "l-yehuda", date: "2026-09-01", amount: 8500, accountId: "a2", rentPeriodStart: "2026-09-01" }),
    // D4's next two months, post-dated checks in hand.
    payment({ id: "k1", propertyId: "p-d4", leaseId: "l-d4", date: "2026-11-11", dueDate: "2026-11-11", amount: 4000, method: "check", checkNumber: "262", paymentStatus: "pending", rentPeriodStart: "2026-11-11" }),
    payment({ id: "k2", propertyId: "p-d4", leaseId: "l-d4", date: "2026-12-11", dueDate: "2026-12-11", amount: 4000, method: "check", checkNumber: "263", paymentStatus: "pending", rentPeriodStart: "2026-12-11" }),
  ],
  accountNames: { a1: "מזרחי בית", a2: "פועלים ויזל" },
};

const fetchMock = vi.fn(async (_url: string) =>
  new Response(JSON.stringify({ files: { [CHECK_ID]: [{ document_id: "d1", file_name: "check.jpg", url: "https://files/check.jpg" }] } }), { status: 200 })
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T10:00:00.000Z"));
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  dialog.props = null;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const table = () => screen.getByRole("table");
const rowOf = (name: string) => within(table()).getByText(name).closest("tr") as HTMLElement;

describe("the rent roll", () => {
  it("a table row a lease: its month, paid or not, when, how, into which account, the check and its photo", async () => {
    await act(async () => {
      render(<RentRollClient data={DATA} />);
    });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("אוקטובר 2026 · חשון תשפ״ז");
    expect(within(table()).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "נכס", "שוכר", "מועד", "שכירות", "מצב", "שולם", "תאריך", "אמצעי", "חשבון", "צ׳ק", "חוב קודם", "צ׳קים ביד", "חוזה עד", "פיקדון", "",
    ]);
    // What was in, and how much of it by check; the checks in hand.
    expect(screen.getByText("(מזה בצ׳קים ₪4,000)")).toBeInTheDocument();
    const d4 = within(rowOf("D4 הר יונה"));
    expect(d4.getByText("שולם")).toBeInTheDocument();
    expect(d4.getByText("12/10/26")).toBeInTheDocument();
    expect(d4.getByText("מזרחי בית")).toBeInTheDocument();
    expect(d4.getByText("#261")).toBeInTheDocument();
    // The photo, from the server after the roll is on screen.
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/rent/files?ids=${CHECK_ID}`);
    expect(d4.getByTitle("צילום הצ׳ק")).toHaveAttribute("href", "https://files/check.jpg");
    // Its checks in hand, to כסלו and טבת; its deposit.
    expect(d4.getByText("2 · עד טבת")).toBeInTheDocument();
    expect(d4.getByText("צ'ק ביטחון ₪8,000")).toBeInTheDocument();
    // October not paid yet — September's payment isn't October's; the lease ends within 60 days.
    const yehuda = within(rowOf("יהודה הנשיא 15"));
    expect(yehuda.getByText("לא שולם")).toBeInTheDocument();
    expect(yehuda.getByText("15/12/26 · עוד 55 ימים")).toBeInTheDocument();
  });

  it("the year at a glance: a cell a month, this one marked", async () => {
    await act(async () => {
      render(<RentRollClient data={DATA} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "שנה" }));
    const cells = within(rowOf("D4 הר יונה")).getAllByRole("button").filter((b) => b.getAttribute("title"));
    expect(cells[0]).toHaveAttribute("title", expect.stringContaining("חשון תשפ״ז: שולם"));
    expect(cells[1]).toHaveAttribute("title", expect.stringContaining("צ׳ק ממתין לפירעון"));
  });

  it("'who owes' leaves only those still owing", async () => {
    await act(async () => {
      render(<RentRollClient data={DATA} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "רק מי שחייב (1)" }));
    expect(within(table()).queryByText("D4 הר יונה")).not.toBeInTheDocument();
    expect(within(table()).getByText("יהודה הנשיא 15")).toBeInTheDocument();
  });

  it("רישום תשלום opens on the row's month, paid the lease's usual way — and the row shows paid at once", async () => {
    await act(async () => {
      render(<RentRollClient data={DATA} />);
    });
    fireEvent.click(within(rowOf("יהודה הנשיא 15")).getByRole("button", { name: "רישום תשלום" }));
    expect(dialog.props?.prefill).toEqual({ periodStart: "2026-10-01", method: "bank_transfer", accountId: "a2" });
    fireEvent.click(screen.getByRole("button", { name: "שמירה (מדומה)" }));
    const yehuda = within(rowOf("יהודה הנשיא 15"));
    expect(yehuda.getByText("שולם")).toBeInTheDocument();
    expect(yehuda.queryByRole("button", { name: "רישום תשלום" })).not.toBeInTheDocument();
  });

  it("steps through the months by each lease's own", async () => {
    await act(async () => {
      render(<RentRollClient data={DATA} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "החודש הקודם" }));
    // D4's lease starts with חשון: September is יהודה הנשיא's alone.
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("ספטמבר 2026");
    expect(within(rowOf("יהודה הנשיא 15")).getByText("שולם")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "לחודש הזה" }));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("אוקטובר 2026 · חשון תשפ״ז");
  });
  it("a check that came back: the month back to unpaid, the check shown as returned, at once", async () => {
    await act(async () => {
      render(<RentRollClient data={DATA} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "החודש הבא" }));
    const d4 = () => within(rowOf("D4 הר יונה"));
    expect(d4().getByText("צ׳ק ממתין לפירעון")).toBeInTheDocument();
    fireEvent.click(d4().getByRole("button", { name: /פעולות לשכירות/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "צ׳ק #262 חזר" }));
    // November isn't due yet (11/11): not paid yet, no longer a check waiting.
    expect(d4().getByText("טרם שולם")).toBeInTheDocument();
    expect(d4().getByText(/#262 · חזר/)).toBeInTheDocument();
  });
});
