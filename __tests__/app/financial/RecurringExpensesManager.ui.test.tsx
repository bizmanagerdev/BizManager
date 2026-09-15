// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
// The shared expense dialog is loaded lazily and is not under test here.
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/reminders/ReminderFormDialog", () => ({ default: () => null }));

import RecurringExpensesManager, { type RecurringExpenseTemplateItem } from "@/app/(app)/financial/RecurringExpensesManager";
import type { OutflowSourceRow } from "@/lib/outflow-source-settings";

// The "תשלומים קבועים" tab: bills and the other fixed outflows rendered as ONE
// list by day of the month, with a monthly pill that sums only what really
// leaves every month. The sources arrive through the tab's own fetch.

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

function src(over: Partial<OutflowSourceRow>): OutflowSourceRow {
  return {
    kind: "salary", key: "k", name: "מקור", scheduleLabel: "", nextDate: null, focusId: null, amount: null,
    href: "/", reminderWorkDaysBefore: null, effectiveReminderDays: 0, accountId: null, isActive: true,
    settled: false, monthly: false,
    ...over,
  };
}

const templates = [
  tpl({ id: "rent", template_name: "שכירות", amount: 5000, expense_day_of_month: 15 }),
  tpl({ id: "arnona", template_name: "ארנונה", amount: 300, expense_day_of_month: 5 }),
];
const sources = [
  src({ kind: "loan", key: "L1", name: "החזר הלוואה — ברנדווין", scheduleLabel: "תשלום חד-פעמי", nextDate: "2099-01-01", focusId: "loan_planned:r1", amount: 157200, monthly: false, href: "/financial/loans/L1" }),
  src({ kind: "card", key: "ויזה", name: "חיוב כרטיס: ויזה", scheduleLabel: "2 לכל חודש · לפי הדף האחרון", nextDate: "2099-01-02", focusId: "ccharge_proj:ויזה:2099-01", amount: null, monthly: false, href: "/financial/statements" }),
  src({ kind: "salary", key: "u1", name: "משכורת דוד", scheduleLabel: "10 לכל חודש", nextDate: "2099-01-10", focusId: "salary_proj:u1:2099-01", amount: 8000, monthly: true, href: "/payroll" }),
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ rows: sources, todayIso: "2026-09-15" }) }))
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RecurringExpensesManager (תשלומים קבועים)", () => {
  it("lists bills and sources together, sorted by the day of the month", async () => {
    render(<RecurringExpensesManager templates={templates} projects={[]} orders={[]} properties={[]} accounts={[{ id: "acc-1", name: "לאומי" } as never]} />);
    await screen.findAllByText("החזר הלוואה — ברנדווין");
    const table = screen.getByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    const names = ["החזר הלוואה — ברנדווין", "חיוב כרטיס: ויזה", "ארנונה", "משכורת דוד", "שכירות"];
    const positions = names.map((n) => bodyRows.findIndex((r) => (r.textContent ?? "").includes(n)));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("shows each row's kind, and a source's controls: account, reminder, active switch, למקור", async () => {
    render(<RecurringExpensesManager templates={templates} projects={[]} orders={[]} properties={[]} accounts={[{ id: "acc-1", name: "לאומי" } as never]} />);
    await screen.findAllByText("משכורת דוד");
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("הוצאה קבועה").length).toBe(2);
    expect(within(table).getAllByText("משכורת").length).toBe(1);
    expect(within(table).getAllByText("כרטיס אשראי").length).toBe(1);
    expect(within(table).getByLabelText("חשבון — משכורת דוד")).toBeTruthy();
    expect(within(table).getByLabelText("תזכורת — משכורת דוד")).toBeTruthy();
    expect(within(table).getByLabelText("פעיל — משכורת דוד").getAttribute("aria-checked")).toBe("true");
    // A card's charge is automatic; a bill without a standing order is not.
    expect(within(table).getByText("אוטומטי")).toBeTruthy();
  });

  it("sums only what leaves every month and says what it left out", async () => {
    render(<RecurringExpensesManager templates={templates} projects={[]} orders={[]} properties={[]} accounts={[]} />);
    await screen.findAllByText("משכורת דוד");
    // 300 + 5,000 + 8,000 — the one-off loan and the card are listed, not summed.
    expect(screen.getByText(/13,300/)).toBeTruthy();
    expect(screen.getByText(/1 הלוואות בהחזר חד-פעמי לא נכללות/)).toBeTruthy();
    expect(screen.getByText(/1 כרטיסי אשראי לא נכללים/)).toBeTruthy();
  });

  it("saves a changed reminder for a source through the settings API", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/outflow-sources/settings")) {
        return { ok: true, json: async () => ({ ok: true, setting: JSON.parse(String(init?.body)) }) };
      }
      return { ok: true, json: async () => ({ rows: sources, todayIso: "2026-09-15" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<RecurringExpensesManager templates={templates} projects={[]} orders={[]} properties={[]} accounts={[]} />);
    await screen.findAllByText("משכורת דוד");
    const table = screen.getByRole("table");
    const select = within(table).getByLabelText("תזכורת — משכורת דוד") as HTMLSelectElement;
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(select, { target: { value: "2" } });
    await vi.waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/api/outflow-sources/settings"));
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]?.body))).toMatchObject({ source_kind: "salary", source_key: "u1", reminder_work_days_before: 2, is_active: true });
    });
  });
});
