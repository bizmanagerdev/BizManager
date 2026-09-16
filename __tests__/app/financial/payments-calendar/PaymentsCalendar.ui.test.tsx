// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
// The expense dialog is loaded lazily and is not under test here.
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/reminders/ReminderFormDialog", () => ({ default: () => null }));

import PaymentsCalendar, { CashNeedsDialog } from "@/app/(app)/financial/payments-calendar/PaymentsCalendar";
import type { PaymentCalendarItem } from "@/lib/payables";
import type { RecurringExpenseTemplateItem } from "@/app/(app)/financial/RecurringExpensesManager";

// Characterization of the payments board as it stands: what the month grid
// shows per day, what the day panel shows for a selected day, how the three
// filters narrow it, and what the header alerts chip counts. These lock the
// behavior before the file is split into smaller pieces.

const TODAY = "2026-09-16";
// The same formatter the board uses — ICU decides where the ₪ and the
// direction marks go, so expectations are built, not typed.
// Testing-library collapses the no-break space ICU puts before the ₪, so the
// expectation does the same.
const ils = (n: number) =>
  new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 })
    .format(n)
    .replace(/ /g, " ");

function item(over: Partial<PaymentCalendarItem> & { id: string; date: string }): PaymentCalendarItem {
  return {
    direction: "out",
    amount: 0,
    label: over.id,
    sourceLabel: "",
    sourceHref: null,
    stage: "pending",
    paymentStatus: "not_paid",
    origin: "expense",
    sourceId: null,
    domainName: "עסק",
    expenseId: null,
    category: null,
    businessDomain: "general_business",
    accountId: null,
    paidAmount: null,
    descriptionRaw: null,
    notes: null,
    paymentMethod: null,
    dueDate: over.date,
    paidDate: null,
    overdue: false,
    installmentGroupId: null,
    installmentIndex: null,
    installmentCount: null,
    expenseProjectId: null,
    expenseOrderId: null,
    expensePropertyId: null,
    workerUserId: null,
    recurringTemplateId: null,
    recurrenceKey: null,
    variableAmount: false,
    autoPaid: false,
    ...over,
  };
}

function tpl(over: Partial<RecurringExpenseTemplateItem>): RecurringExpenseTemplateItem {
  return {
    id: "t", template_name: "תבנית", category: "כללי", amount: 100, is_variable_amount: false, auto_paid: false,
    reminder_work_days_before: null, description_template: null, notes_template: null, business_domain: "general_business",
    project_id: null, order_id: null, property_id: null, account_id: null, included_in_base_price: false,
    billed_to_customer: false, project_expense_notes_template: null, frequency: "monthly", interval_months: 1,
    create_day_of_month: 1, expense_day_of_month: 1, create_month_of_year: null, expense_month_of_year: null,
    start_date: "2026-01-01", end_date: null, is_active: true,
    ...over,
  };
}

const templates = [tpl({ id: "tpl-1", template_name: "ארנונה", amount: 1200, expense_day_of_month: 20 })];

const items: PaymentCalendarItem[] = [
  // A generated bill of a live template, unpaid, later this month, from account acc-1.
  item({ id: "expense:e1", date: "2026-09-20", amount: 1200, label: "ארנונה", expenseId: "e1", recurringTemplateId: "tpl-1", accountId: "acc-1" }),
  // A one-off bill more than a week late.
  item({ id: "expense:e2", date: "2026-09-01", amount: 500, label: "חשמל", expenseId: "e2", overdue: true }),
  // A paid bill earlier this month.
  item({ id: "expense:e3", date: "2026-09-10", amount: 300, label: "מים", expenseId: "e3", stage: "posted", paymentStatus: "paid" }),
  // A paid bill today.
  item({ id: "expense:e4", date: TODAY, amount: 90, label: "דלק", expenseId: "e4", stage: "posted", paymentStatus: "paid" }),
  // A projected salary (no row yet).
  item({ id: "salary_proj:u1:2026-09", date: "2026-09-25", amount: 8000, label: "משכורת דוד", stage: "scheduled", origin: "worker_owed", paymentStatus: null }),
  // A coming card charge: a day marker with no amount.
  item({ id: "ccharge_proj:ויזה:2026-09", date: "2026-09-18", amount: 0, label: "חיוב כרטיס: ויזה", stage: "scheduled", origin: "expense", paymentStatus: null, variableAmount: true }),
  // Next month's forecast of the same template.
  item({ id: "recur_proj:tpl-1:2026-10", date: "2026-10-20", amount: 1200, label: "ארנונה", stage: "scheduled", paymentStatus: null, recurringTemplateId: "tpl-1", recurrenceKey: "2026-10" }),
];

const accounts = [{ id: "acc-1", name: "לאומי" }] as never[];
// The income dialog's pickers; the add-a-receipt flow has its own test.
const noIncomeOptions = { projects: [], orders: [], properties: [] };

let slot: HTMLDivElement;
// The board portals its alerts chip and its data filters into the page header,
// so a test has to provide both landing spots.
let filters: HTMLDivElement;
beforeEach(() => {
  slot = document.createElement("div");
  filters = document.createElement("div");
  document.body.append(slot, filters);
});
afterEach(() => {
  slot.remove();
  filters.remove();
});

function renderBoard(over: Partial<React.ComponentProps<typeof PaymentsCalendar>> = {}) {
  return render(
    <PaymentsCalendar
      items={items}
      todayIso={TODAY}
      projects={[]}
      properties={[]}
      orders={[]}
      accounts={accounts}
      templates={templates}
      incomeOptions={noIncomeOptions}
      alertsSlot={slot}
      filtersSlot={filters}
      direction="out"
      {...over}
    />
  );
}

// The grid cell for a day of the month in view: the button whose date header
// shows that number and that isn't an adjacent-month filler cell.
function dayCell(dayOfMonth: number): HTMLElement {
  const cells = screen
    .getAllByText(String(dayOfMonth), { selector: "span" })
    .map((el) => el.closest("button"))
    .filter((b): b is HTMLButtonElement => Boolean(b) && !b!.className.includes("text-muted-foreground/45"));
  if (cells.length !== 1) throw new Error(`expected one in-month cell for day ${dayOfMonth}, found ${cells.length}`);
  return cells[0];
}

// The selected-day panel is the calendar's <aside>. Anchoring on it (rather
// than on something inside) keeps the helper working whatever the panel offers
// for the direction on screen.
function selectedPanel(): HTMLElement {
  const aside = document.querySelector("aside");
  if (!aside) throw new Error("no day panel rendered");
  return aside as HTMLElement;
}

describe("PaymentsCalendar (צפי תזרים · לוח) — the board as it stands", () => {
  it("opens on today's month with unpaid amounts per day, paid ones hidden, and a marker for a variable charge", () => {
    renderBoard();
    expect(within(dayCell(20)).getByText(ils(1200))).toBeTruthy();
    expect(within(dayCell(1)).getByText(ils(500))).toBeTruthy();
    expect(within(dayCell(25)).getByText(ils(8000))).toBeTruthy();
    expect(within(dayCell(18)).getByText("משתנה")).toBeTruthy();
    // Paid rows are not on the grid until "הצג ששולמו".
    expect(within(dayCell(10)).queryByText(ils(300))).toBeNull();
    // The legend explains the four dots.
    const legend = screen.getByLabelText("מקרא");
    expect(legend.textContent).toContain("באיחור");
    expect(legend.textContent).toContain("שולם");
  });

  it("selects today by default: an eyebrow, the empty state when nothing is left to pay, and the add button", () => {
    renderBoard();
    const panel = selectedPanel();
    expect(within(panel).getByText("היום")).toBeTruthy();
    expect(within(panel).getByText("אין תשלומים ביום זה")).toBeTruthy();
    expect(within(panel).getByText("הוסף תשלום ליום זה")).toBeTruthy();
  });

  it("clicking a day shows its payments with the day's to-pay total and the card's actions", () => {
    renderBoard();
    fireEvent.click(dayCell(20));
    const panel = selectedPanel();
    expect(within(panel).getByText("ארנונה")).toBeTruthy();
    expect(within(panel).getByText("לתשלום ביום זה")).toBeTruthy();
    expect(within(panel).getAllByText(ils(1200)).length).toBeGreaterThanOrEqual(2); // total + card
    expect(within(panel).getByText("מחשבון לאומי")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "סמן כשולם" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "פעולות — ארנונה" })).toBeTruthy();
    // The card is the focus target for ?focus= / למקור.
    expect(panel.querySelector('[data-focus-id="expense:e1"]')).toBeTruthy();
  });

  it("a day whose only payment is already paid says so once paid rows are shown", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "הצג ששולמו" }));
    expect(within(dayCell(10)).getByText(ils(300))).toBeTruthy();
    fireEvent.click(dayCell(10));
    const panel = selectedPanel();
    expect(within(panel).getByText("מים")).toBeTruthy();
    expect(within(panel).getByText("כל התשלומים ביום זה שולמו")).toBeTruthy();
    // No mark-paid on a paid row.
    expect(within(panel).queryByRole("button", { name: "סמן כשולם" })).toBeNull();
  });

  it("\"רק קבועות\" keeps only rows of a recurring template", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "רק קבועות" }));
    expect(within(dayCell(20)).getByText(ils(1200))).toBeTruthy();
    expect(within(dayCell(25)).queryByText(ils(8000))).toBeNull();
    expect(within(dayCell(1)).queryByText(ils(500))).toBeNull();
  });

  it("the account filter scopes the grid and the alerts chip alike", () => {
    renderBoard();
    expect(within(slot).getByLabelText("תשלומים באיחור: 1")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("סינון לפי חשבון"), { target: { value: "acc-1" } });
    expect(within(dayCell(20)).getByText(ils(1200))).toBeTruthy();
    expect(within(dayCell(25)).queryByText(ils(8000))).toBeNull();
    // The late bill has no account, so it leaves the chip too.
    expect(within(slot).queryByLabelText(/תשלומים באיחור/)).toBeNull();
  });

  it("the alerts chip counts only unpaid bills past their date, red once one is over a week late", () => {
    renderBoard();
    const chip = within(slot).getByLabelText("תשלומים באיחור: 1");
    expect(chip.textContent).toContain("באיחור 1");
    expect(chip.className).toContain("text-destructive");
  });

  it("the chip is amber while nothing is more than a week late, and absent with nothing late", () => {
    const { unmount } = renderBoard({
      items: [item({ id: "expense:late", date: "2026-09-14", amount: 10, label: "קטן", expenseId: "l", overdue: true })],
    });
    const chip = within(slot).getByLabelText("תשלומים באיחור: 1");
    expect(chip.className).toContain("text-warning-strong");
    unmount();
    renderBoard({ items: items.filter((i) => i.id !== "expense:e2") });
    expect(within(slot).queryByLabelText(/תשלומים באיחור/)).toBeNull();
  });
});


// The calculator reads as a statement: each step is a heading with its own
// total, and the running lines between them carry the answer. A step's total
// sits next to its title; a running line's sits next to its label.
function stepTotal(title: string): string {
  const heading = screen.getByText(title);
  const row = heading.parentElement as HTMLElement;
  return (row.textContent ?? "").replace(title, "").replace(/\u00a0/g, " ").trim();
}

describe("CashNeedsDialog (\u05db\u05de\u05d4 \u05e6\u05e8\u05d9\u05da?)", () => {
  it("lists what goes out in the range, with that step's total", () => {
    render(<CashNeedsDialog open onOpenChange={() => {}} items={items} accounts={accounts} todayIso={TODAY} />);
    // 16..23: \u05d0\u05e8\u05e0\u05d5\u05e0\u05d4 on the 20th + the card marker on the 18th (no amount).
    expect(stepTotal("\u05d9\u05d5\u05e6\u05d0")).toBe(`\u2212${ils(1200)}`);
    expect(screen.getByText("\u05d0\u05e8\u05e0\u05d5\u05e0\u05d4")).toBeTruthy();
  });

  it("the quick ranges and the recurring-only chip narrow the step", () => {
    render(<CashNeedsDialog open onOpenChange={() => {}} items={items} accounts={accounts} todayIso={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "\u05d7\u05d5\u05d3\u05e9" }));
    // + the salary on the 25th; the late bill (1st) and paid rows never count.
    expect(stepTotal("\u05d9\u05d5\u05e6\u05d0")).toBe(`\u2212${ils(9200)}`);
    fireEvent.click(screen.getByRole("button", { name: "\u05e8\u05e7 \u05d4\u05d5\u05e6\u05d0\u05d5\u05ea \u05e7\u05d1\u05d5\u05e2\u05d5\u05ea" }));
    expect(stepTotal("\u05d9\u05d5\u05e6\u05d0")).toBe(`\u2212${ils(1200)}`);
  });

  it("separates money that will arrive from money that depends on collection", () => {
    const rows = [
      item({ id: "expense:a", date: "2026-09-18", amount: 5000, label: "\u05e1\u05e4\u05e7", expenseId: "a" }),
      item({ id: "payment:b", direction: "in", date: "2026-09-19", amount: 3000, label: "\u05e6\u05f3\u05e7", origin: "payment", stage: "scheduled", paymentId: "b" }),
      item({ id: "order-receivable:c", direction: "in", date: "2026-09-19", amount: 8000, label: "\u05d3\u05d5\u05d3 \u05dc\u05d5\u05d9", origin: "order_receivable", stage: "pending" }),
    ];
    render(<CashNeedsDialog open onOpenChange={() => {}} items={rows} accounts={accounts} todayIso={TODAY} direction="all" />);
    expect(stepTotal("\u05d9\u05d5\u05e6\u05d0")).toBe(`\u2212${ils(5000)}`);
    expect(stepTotal("\u05e0\u05db\u05e0\u05e1")).toBe(`+${ils(3000)}`);
    expect(stepTotal("\u05e0\u05db\u05e0\u05e1 \u00b7 \u05ea\u05dc\u05d5\u05d9 \u05d1\u05d2\u05d1\u05d9\u05d9\u05d4")).toBe(`+${ils(8000)}`);
    // 3,000 against 5,000 \u2014 short 2,000 on money that will actually arrive.
    expect(stepTotal("\u05e6\u05e8\u05d9\u05da")).toBe(ils(2000));
    // 11,000 against 5,000 if the debt is collected too.
    expect(stepTotal("\u05e2\u05d5\u05d3\u05e3 \u05d0\u05d7\u05e8\u05d9 \u05d2\u05d1\u05d9\u05d9\u05d4")).toBe(ils(6000));
  });

  it("shows no collection step when every incoming shekel is already committed", () => {
    const rows = [
      item({ id: "expense:a", date: "2026-09-18", amount: 5000, label: "\u05e1\u05e4\u05e7", expenseId: "a" }),
      item({ id: "payment:b", direction: "in", date: "2026-09-19", amount: 9000, label: "\u05e6\u05f3\u05e7", origin: "payment", stage: "scheduled", paymentId: "b" }),
    ];
    render(<CashNeedsDialog open onOpenChange={() => {}} items={rows} accounts={accounts} todayIso={TODAY} direction="all" />);
    expect(screen.queryByText("\u05e0\u05db\u05e0\u05e1 \u00b7 \u05ea\u05dc\u05d5\u05d9 \u05d1\u05d2\u05d1\u05d9\u05d9\u05d4")).toBeNull();
    expect(screen.queryByText(/\u05d0\u05d7\u05e8\u05d9 \u05d2\u05d1\u05d9\u05d9\u05d4/)).toBeNull();
    expect(stepTotal("\u05e2\u05d5\u05d3\u05e3")).toBe(ils(4000));
  });

  it("says so when the range is empty", () => {
    render(<CashNeedsDialog open onOpenChange={() => {}} items={[]} accounts={accounts} todayIso={TODAY} />);
    expect(screen.getByText("\u05d0\u05d9\u05df \u05ea\u05e0\u05d5\u05e2\u05d5\u05ea \u05d1\u05d8\u05d5\u05d5\u05d7 \u05e9\u05e0\u05d1\u05d7\u05e8.")).toBeTruthy();
  });
});

// ── The incoming half, and both together ─────────────────────────────────────
// Same board, same grid, same day panel; what changes is which rows are on it
// and the words used about them.

const incomingItems: PaymentCalendarItem[] = [
  // A post-dated check due later this month, from a named customer.
  item({
    id: "payment:pay1", direction: "in", date: "2026-09-22", amount: 4000, label: "\u05e6\u05f3\u05e7 4321",
    origin: "payment", stage: "scheduled", paymentStatus: "pending", paymentId: "pay1",
    customerId: "c1", customerName: "\u05de\u05d0\u05e4\u05d9\u05d9\u05ea \u05dc\u05d7\u05dd", reference: "4321",
    sourceLabel: "\u05de\u05d0\u05e4\u05d9\u05d9\u05ea \u05dc\u05d7\u05dd \u00b7 \u05d4\u05d6\u05de\u05e0\u05d4 4f3c1b2a",
  }),
  // A customer balance that went past its due date.
  item({
    id: "order-receivable:o9", direction: "in", date: "2026-09-02", amount: 1500, label: "\u05d9\u05ea\u05e8\u05ea \u05dc\u05e7\u05d5\u05d7 \u05dc\u05ea\u05e9\u05dc\u05d5\u05dd",
    origin: "order_receivable", stage: "pending", paymentStatus: "pending", overdue: true,
    customerId: "c2", customerName: "\u05d3\u05d5\u05d3 \u05dc\u05d5\u05d9", sourceLabel: "\u05d3\u05d5\u05d3 \u05dc\u05d5\u05d9 \u00b7 \u05d4\u05d6\u05de\u05e0\u05d4 9a8b7c6d",
  }),
];

describe("PaymentsCalendar \u2014 \u05e0\u05db\u05e0\u05e1 (incoming)", () => {
  it("shows only incoming rows and calls the day's money collection, not payment", () => {
    renderBoard({ items: [...items, ...incomingItems], direction: "in" });
    // The outgoing bill on the 20th is gone; the check on the 22nd is there.
    expect(within(dayCell(22)).getByText(ils(4000))).toBeTruthy();
    expect(within(dayCell(20)).queryByText(ils(1200))).toBeNull();
    fireEvent.click(dayCell(22));
    const panel = selectedPanel();
    expect(within(panel).getByText("\u05dc\u05d2\u05d1\u05d9\u05d9\u05d4 \u05d1\u05d9\u05d5\u05dd \u05d6\u05d4")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "\u05e1\u05de\u05df \u05db\u05e0\u05d2\u05d1\u05d4" })).toBeTruthy();
    // The customer is on the row, not just an unreadable order number.
    expect(within(panel).getByText(/\u05de\u05d0\u05e4\u05d9\u05d9\u05ea \u05dc\u05d7\u05dd/)).toBeTruthy();
  });

  it("says \u05d0\u05d9\u05df \u05ea\u05e7\u05d1\u05d5\u05dc\u05d9\u05dd on an empty day and drops the bills-only filter", () => {
    renderBoard({ items: [...items, ...incomingItems], direction: "in" });
    expect(within(selectedPanel()).getByText("\u05d0\u05d9\u05df \u05ea\u05e7\u05d1\u05d5\u05dc\u05d9\u05dd \u05d1\u05d9\u05d5\u05dd \u05d6\u05d4")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "\u05e8\u05e7 \u05e7\u05d1\u05d5\u05e2\u05d5\u05ea" })).toBeNull();
  });

  it("counts an overdue receivable in the chip, worded for money owed to us", () => {
    renderBoard({ items: incomingItems, direction: "in" });
    expect(within(slot).getByLabelText("\u05ea\u05e7\u05d1\u05d5\u05dc\u05d9\u05dd \u05d1\u05d0\u05d9\u05d7\u05d5\u05e8: 1")).toBeTruthy();
  });

  it("offers no mark-collected on a receivable that has no payment row yet", () => {
    renderBoard({ items: incomingItems, direction: "in" });
    fireEvent.click(dayCell(2));
    const panel = selectedPanel();
    expect(within(panel).getByText("\u05d9\u05ea\u05e8\u05ea \u05dc\u05e7\u05d5\u05d7 \u05dc\u05ea\u05e9\u05dc\u05d5\u05dd")).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "\u05e1\u05de\u05df \u05db\u05e0\u05d2\u05d1\u05d4" })).toBeNull();
  });
});

describe("PaymentsCalendar \u2014 \u05d4\u05db\u05dc (both directions)", () => {
  const both = [...items, ...incomingItems];

  it("shows a day's two sides in the grid instead of a stage breakdown", () => {
    renderBoard({ items: both, direction: "all" });
    expect(within(dayCell(22)).getByText(ils(4000))).toBeTruthy();
    expect(within(dayCell(20)).getByText(ils(1200))).toBeTruthy();
    // The signs are what tell them apart.
    expect(within(dayCell(22)).getByText("+")).toBeTruthy();
    expect(within(dayCell(20)).getByText("\u2212")).toBeTruthy();
  });

  it("gives a mixed day both figures and their net", () => {
    // The 20th has a bill out; add a receipt on the same day.
    const sameDay = [...both, item({ id: "payment:same", direction: "in", date: "2026-09-20", amount: 2000, label: "\u05d4\u05e2\u05d1\u05e8\u05d4", origin: "payment", stage: "scheduled", paymentId: "same" })];
    renderBoard({ items: sameDay, direction: "all" });
    fireEvent.click(dayCell(20));
    const panel = selectedPanel();
    expect(within(panel).getByText("\u05dc\u05d2\u05d1\u05d9\u05d9\u05d4 \u05d1\u05d9\u05d5\u05dd \u05d6\u05d4")).toBeTruthy();
    expect(within(panel).getByText("\u05dc\u05ea\u05e9\u05dc\u05d5\u05dd \u05d1\u05d9\u05d5\u05dd \u05d6\u05d4")).toBeTruthy();
    expect(within(panel).getByText("\u05e0\u05d8\u05d5")).toBeTruthy();
    // 2,000 in - 1,200 out = 800 to the good.
    expect(within(panel).getByText(ils(800))).toBeTruthy();
  });

  it("the chip stops claiming everything late is a bill", () => {
    renderBoard({ items: both, direction: "all" });
    expect(within(slot).getByLabelText("\u05ea\u05e9\u05dc\u05d5\u05de\u05d9\u05dd \u05d5\u05ea\u05e7\u05d1\u05d5\u05dc\u05d9\u05dd \u05d1\u05d0\u05d9\u05d7\u05d5\u05e8: 2")).toBeTruthy();
  });
});

describe("Recording money that comes in", () => {
  const ADD_PAYMENT = "\u05d4\u05d5\u05e1\u05e3 \u05ea\u05e9\u05dc\u05d5\u05dd \u05dc\u05d9\u05d5\u05dd \u05d6\u05d4";
  const ADD_RECEIPT = "\u05d4\u05d5\u05e1\u05e3 \u05ea\u05e7\u05d1\u05d5\u05dc \u05dc\u05d9\u05d5\u05dd \u05d6\u05d4";

  it("offers a receipt button on the incoming board and a payment button on the outgoing one", () => {
    const { unmount } = renderBoard({ items: incomingItems, direction: "in" });
    expect(screen.getByRole("button", { name: ADD_RECEIPT })).toBeTruthy();
    expect(screen.queryByRole("button", { name: ADD_PAYMENT })).toBeNull();
    unmount();
    renderBoard({ items, direction: "out" });
    expect(screen.getByRole("button", { name: ADD_PAYMENT })).toBeTruthy();
    expect(screen.queryByRole("button", { name: ADD_RECEIPT })).toBeNull();
  });

  it("offers neither on \u05d4\u05db\u05dc \u2014 two buttons crowded the panel, and the app's + creates either kind", () => {
    renderBoard({ items: [...items, ...incomingItems], direction: "all" });
    expect(screen.queryByRole("button", { name: ADD_PAYMENT })).toBeNull();
    expect(screen.queryByRole("button", { name: ADD_RECEIPT })).toBeNull();
  });
});
