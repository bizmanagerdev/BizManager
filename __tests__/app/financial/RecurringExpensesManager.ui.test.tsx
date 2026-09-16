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
    // Counted over the body rows only — the kind filter in the column header
    // offers the same words as options.
    const bodyText = within(table).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    const countRowsWith = (needle: string) => bodyText.filter((t) => t.includes(needle)).length;
    expect(countRowsWith("הוצאה קבועה")).toBe(2);
    expect(countRowsWith("משכורת")).toBe(1);
    expect(countRowsWith("כרטיס אשראי")).toBe(1);
    // Each of the three fields is a cell showing its value that swaps to the
    // real control when opened — the same on a source row and a bill row.
    expect(within(table).getByLabelText("חשבון — משכורת דוד: עריכה")).toBeTruthy();
    expect(within(table).getByLabelText("תזכורת — משכורת דוד: עריכה")).toBeTruthy();
    expect(within(table).getByLabelText("פעיל — משכורת דוד: עריכה")).toBeTruthy();
    // A card's charge is automatic — said as a caption under its amount.
    expect(within(table).getByText("אוטומטי")).toBeTruthy();
    // Bills edit the same three fields in place, the same way sources do.
    expect(within(table).getByLabelText("חשבון — שכירות: עריכה")).toBeTruthy();
    expect(within(table).getByLabelText("תזכורת — שכירות: עריכה")).toBeTruthy();
    expect(within(table).getByLabelText("פעיל — שכירות: עריכה")).toBeTruthy();
    // Opening the active cell reveals the switch itself, already on.
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.mouseDown(within(table).getByLabelText("פעיל — משכורת דוד: עריכה"));
    expect(within(table).getByLabelText("פעיל — משכורת דוד").getAttribute("aria-checked")).toBe("true");
  });

  it("sums only what leaves every month and says what it left out", async () => {
    render(<RecurringExpensesManager templates={templates} projects={[]} orders={[]} properties={[]} accounts={[]} />);
    await screen.findAllByText("משכורת דוד");
    // 300 + 5,000 + 8,000 — the one-off loan and the card are listed, not summed.
    expect(screen.getByText(/13,300/)).toBeTruthy();
    expect(screen.getByText(/1 הלוואות בהחזר חד-פעמי/)).toBeTruthy();
    expect(screen.getByText(/1 כרטיסי אשראי/)).toBeTruthy();
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
    const { fireEvent } = await import("@testing-library/react");
    // The cell opens into the select, then the choice saves.
    fireEvent.mouseDown(within(table).getByLabelText("תזכורת — משכורת דוד: עריכה"));
    const select = within(table).getByLabelText("תזכורת — משכורת דוד") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "2" } });
    await vi.waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/api/outflow-sources/settings"));
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]?.body))).toMatchObject({ source_kind: "salary", source_key: "u1", reminder_work_days_before: 2, is_active: true });
    });
  });
});

// ── The incoming half of the same list ──────────────────────────────────────
// Rent, loans the business gave out and the card settlement are "what happens
// every month" too. They share the row shape but have nowhere to store
// settings, so they are listed, not managed.

const inflowSources = [
  src({
    kind: "rent", key: "L1", name: "שכר דירה — הרצל 5", scheduleLabel: "10 לכל חודש",
    nextDate: "2099-01-10", amount: 4000, monthly: true, href: "/properties/p1",
    direction: "in", configurable: false,
  }),
];

describe("RecurringExpensesManager — incoming sources", () => {
  it("shows only incoming rows in the נכנס view, with no recurring bills", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ rows: [...sources, ...inflowSources], todayIso: "2026-09-15" }) }))
    );
    render(
      <RecurringExpensesManager
        templates={templates}
        projects={[]}
        orders={[]}
        properties={[]}
        accounts={[]}
        direction="in"
      />
    );
    await screen.findAllByText("שכר דירה — הרצל 5");
    const table = screen.getByRole("table");
    const body = within(table).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(body.filter((t) => t.includes("שכר דירה"))).toHaveLength(1);
    // Bills are outgoing by definition, and so are salaries. (Checked by the
    // kind badge, not by name: the rent row says "מנוהל בחוזה השכירות",
    // which contains a template name as a substring.)
    expect(body.filter((t) => t.includes("הוצאה קבועה"))).toHaveLength(0);
    expect(body.filter((t) => t.includes("משכורת דוד"))).toHaveLength(0);
  });

  it("offers no settings controls on a row that has nowhere to store them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ rows: inflowSources, todayIso: "2026-09-15" }) }))
    );
    render(
      <RecurringExpensesManager templates={[]} projects={[]} orders={[]} properties={[]} accounts={[]} direction="in" />
    );
    await screen.findAllByText("שכר דירה — הרצל 5");
    const table = screen.getByRole("table");
    // A control that threw the change away would be worse than none.
    expect(within(table).queryByLabelText(/חשבון — שכר דירה/)).toBeNull();
    expect(within(table).queryByLabelText(/תזכורת — שכר דירה/)).toBeNull();
  });

  it("keeps the outgoing list unchanged when no direction is given", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ rows: [...sources, ...inflowSources], todayIso: "2026-09-15" }) }))
    );
    render(<RecurringExpensesManager templates={templates} projects={[]} orders={[]} properties={[]} accounts={[]} />);
    await screen.findAllByText("משכורת דוד");
    const body = within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(body.filter((t) => t.includes("שכר דירה"))).toHaveLength(0);
  });
});
