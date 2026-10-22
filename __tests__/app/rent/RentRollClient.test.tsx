// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

// The rent page (owner, 2026-10-21), redone after looking at property software:
// what to do first, four plain figures, each lease the most urgent first with
// its details under it, and the year at a glance. Before that: on a computer a plain table — what it is,
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
            tornAt: null,
            rentAllocation: null,
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
    DropdownMenuSeparator: () => <hr />,
  };
});

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
    tornAt: null,
    rentAllocation: null,
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
/** What needs handling: its button in the row under the tabs, and its list — a panel over the page. */
const todoButton = () => screen.getByRole("button", { name: /לטיפול/ });
const todo = () => screen.getByRole("dialog", { name: "לטיפול" });
const owingHeader = () => within(table()).getByRole("button", { name: "חוב ישן" });

async function show() {
  await act(async () => {
    render(<RentRollClient data={DATA} />);
  });
}

describe("the rent page", () => {
  it("what needs handling starts closed — a small button with how many; it opens over the page, and closes", async () => {
    await show();
    expect(todoButton()).toHaveAttribute("aria-expanded", "false");
    expect(todoButton()).toHaveTextContent("2");
    expect(screen.queryByRole("dialog", { name: "לטיפול" })).not.toBeInTheDocument();
    fireEvent.click(todoButton());
    const lines = within(todo()).getAllByRole("listitem").map((li) => li.textContent);
    expect(lines[0]).toContain("באיחור");
    expect(lines[0]).toContain("יהודה הנשיא 15 · ווגשל · ₪8,500 · 20 ימים");
    expect(lines.some((l) => l?.includes("חוזה מסתיים") && l.includes("15/12/26 (עוד 55 ימים)"))).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "לטיפול" })).not.toBeInTheDocument();
    fireEvent.click(todoButton());
    fireEvent.click(within(todo()).getByRole("button", { name: "סגירה" }));
    expect(screen.queryByRole("dialog", { name: "לטיפול" })).not.toBeInTheDocument();
  });

  it("four plain figures: collected of the month, late, checks to deposit, checks in hand — the checks ones open the checks page", async () => {
    await show();
    expect(screen.getByText("מתוך ₪12,500 · 1 מתוך 2 שילמו")).toBeInTheDocument();
    expect(screen.getByText("שוכר אחד").parentElement).toHaveTextContent("באיחור₪8,500");
    expect(screen.getByRole("link", { name: /צ׳קים להפקדה/ })).toHaveAttribute("href", "/checks?property=rent&filter=week");
    const inHand = screen.getByRole("link", { name: /צ׳קים ביד/ });
    expect(inHand).toHaveTextContent("2 צ׳קים");
    expect(inHand).toHaveTextContent("₪8,000 שעוד לא הופקדו");
  });

  it("each lease a row, the most urgent first; a row opens its details — the payment, its account, the check and its photo", async () => {
    await show();
    expect(within(table()).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "נכס", "שוכר", "שכירות", "החודש", "חוב ישן", "צ׳קים ביד", "חוזה עד", "פעולות",
    ]);
    const rows = within(table()).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(rows[0]).toContain("יהודה הנשיא 15");
    expect(within(rowOf("יהודה הנשיא 15")).getByText("באיחור")).toBeInTheDocument();
    expect(within(rowOf("D4 הר יונה")).getByText("2 · עד טבת")).toBeInTheDocument();
    fireEvent.click(within(rowOf("D4 הר יונה")).getByText("רוזנפלד"));
    const details = rowOf("D4 הר יונה").nextElementSibling as HTMLElement;
    expect(details).toHaveTextContent("צ׳ק #261");
    expect(details).toHaveTextContent("מזרחי בית");
    expect(details).toHaveTextContent("פיקדוןצ'ק ביטחון ₪8,000");
    // What the row already says isn't said again, and nothing in red while the check simply waits.
    expect(details).not.toHaveTextContent("לפירעון");
    expect(details.querySelector(".text-destructive")).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toContain(`/api/rent/files?ids=${CHECK_ID}`);
    expect(within(details).getByTitle("צילום הצ׳ק")).toHaveAttribute("href", "https://files/check.jpg");
    fireEvent.click(within(details).getByRole("button", { name: "עוד פעולות" }));
    expect(within(details).getByRole("link", { name: "הצ׳קים של הנכס" })).toHaveAttribute("href", "/checks?property=p-d4");
    expect(within(details).getByRole("link", { name: "לדף הנכס" })).toHaveAttribute("href", "/properties/p-d4#rent");
  });

  it("'רישום תשלום' opens on the row's month, paid the lease's usual way — the row shows paid at once, and it's off the list", async () => {
    await show();
    fireEvent.click(within(rowOf("יהודה הנשיא 15")).getByRole("button", { name: "רישום תשלום" }));
    expect(dialog.props?.prefill).toEqual({ periodStart: "2026-10-01", method: "bank_transfer", accountId: "a2" });
    fireEvent.click(screen.getByRole("button", { name: "שמירה (מדומה)" }));
    expect(within(rowOf("יהודה הנשיא 15")).getByText("שולם")).toBeInTheDocument();
    fireEvent.click(todoButton());
    expect(within(todo()).queryByText("באיחור")).not.toBeInTheDocument();
  });

  it("from the list: its line's 'רישום תשלום' closes the list and opens the payment", async () => {
    await show();
    fireEvent.click(todoButton());
    fireEvent.click(within(todo()).getAllByRole("button", { name: "רישום תשלום" })[0]);
    expect(screen.queryByRole("dialog", { name: "לטיפול" })).not.toBeInTheDocument();
    expect(dialog.props?.open).toBe(true);
  });

  it("the debt column's header filters: only who owes — and back, the header still there", async () => {
    await show();
    fireEvent.click(owingHeader());
    expect(owingHeader()).toHaveAttribute("aria-pressed", "true");
    expect(within(table()).queryByText("D4 הר יונה")).not.toBeInTheDocument();
    expect(within(table()).getByText("יהודה הנשיא 15")).toBeInTheDocument();
    fireEvent.click(owingHeader());
    expect(within(table()).getByText("D4 הר יונה")).toBeInTheDocument();
  });

  it("another month: back and on by each lease's own months, and back to this one; what needs handling stays with today", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "חודש קודם" }));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("ספטמבר 2026");
    expect(within(rowOf("יהודה הנשיא 15")).getByText("שולם")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /לטיפול/ })).not.toBeInTheDocument();
    expect(screen.getByText("נגבה בחודש הזה")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));
    fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("נובמבר 2026 · כסלו תשפ״ז");
    expect(within(rowOf("D4 הר יונה")).getByText("צ׳ק ממתין לפירעון")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "היום" }));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("אוקטובר 2026 · חשון תשפ״ז");
  });

  it("the tab row only switches tabs — no count on it", async () => {
    await show();
    expect(screen.getByRole("tab", { name: /חודש/ }).textContent).toBe("חודש");
  });

  it("the year at a glance: a cell a month, the months ahead with a check in hand outlined, each month's share collected", async () => {
    await show();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /לוח שנתי/ }));
    fireEvent.click(screen.getByRole("tab", { name: /לוח שנתי/ }));
    const cells = within(rowOf("D4 הר יונה")).getAllByRole("button");
    expect(cells[0]).toHaveAttribute("title", expect.stringContaining("חשון תשפ״ז: שולם"));
    expect(cells[1]).toHaveAttribute("title", expect.stringContaining("כסלו תשפ״ז: צ׳ק ביד"));
    expect(cells[1].className).toContain("border-dashed");
    // October: ₪4,000 in of ₪12,500 due.
    expect(within(table()).getByText("32%")).toBeInTheDocument();
  });

  // Last: the bounce leaves its patch in the undo engine (module state).
  it("a check that came back: the month back to owing, the check shown as returned, at once", async () => {
    await show();
    fireEvent.click(within(rowOf("D4 הר יונה")).getByText("רוזנפלד"));
    const details = rowOf("D4 הר יונה").nextElementSibling as HTMLElement;
    fireEvent.click(within(details).getByRole("button", { name: "עוד פעולות" }));
    fireEvent.click(within(details).getByRole("menuitem", { name: "סימון צ׳ק #261 כחוזר" }));
    expect(within(rowOf("D4 הר יונה")).getByText("צ׳ק חזר")).toBeInTheDocument();
    fireEvent.click(todoButton());
    expect(within(todo()).getByText("צ׳ק חזר")).toBeInTheDocument();
  });
});
