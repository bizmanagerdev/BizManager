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

let slot: HTMLDivElement;
beforeEach(() => {
  slot = document.createElement("div");
  document.body.appendChild(slot);
});
afterEach(() => {
  slot.remove();
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
      alertsSlot={slot}
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

function selectedPanel(): HTMLElement {
  return screen.getByText("הוסף תשלום ליום זה").closest("aside") as HTMLElement;
}

describe("PaymentsCalendar (לוח תשלומים) — the board as it stands", () => {
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


// The calculator's headline figure (the rundown below it repeats each row's amount).
function cashTotal(): string {
  return (screen.getByText("סה״כ נדרש").nextElementSibling?.textContent ?? "").replace(/ /g, " ");
}

describe("CashNeedsDialog (כמה צריך?)", () => {
  it("sums the unpaid amounts in the range, defaulting to the coming week", () => {
    render(<CashNeedsDialog open onOpenChange={() => {}} items={items} accounts={accounts} todayIso={TODAY} />);
    // 16..23: ארנונה (20th) + the card marker (18th, no amount).
    expect(cashTotal()).toBe(ils(1200));
    expect(screen.getByText("2 תשלומים")).toBeTruthy();
  });

  it("the quick ranges and the recurring-only chip narrow it", () => {
    render(<CashNeedsDialog open onOpenChange={() => {}} items={items} accounts={accounts} todayIso={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "חודש" }));
    // + the salary on the 25th; the late bill (1st) and paid rows never count.
    expect(cashTotal()).toBe(ils(9200));
    expect(screen.getByText("3 תשלומים")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "רק הוצאות קבועות" }));
    expect(cashTotal()).toBe(ils(1200));
    expect(screen.getByText("1 תשלומים")).toBeTruthy();
  });
});
