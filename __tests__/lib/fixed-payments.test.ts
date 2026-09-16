import { describe, it, expect } from "vitest";
import { buildFixedPaymentRows, summarizeFixedPayments, templateNextPaymentTime } from "@/lib/fixed-payments";
import type { RecurringExpenseTemplateItem } from "@/app/(app)/financial/RecurringExpensesManager";
import type { OutflowSourceRow } from "@/lib/outflow-source-settings";

// The "תשלומים קבועים" list: bills and the other fixed outflows as ONE list by
// day of the month, and a monthly-commitment pill that only sums what really
// leaves every month.

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

const today = new Date(2026, 8, 15); // 15 Sep 2026

const templates = [
  tpl({ id: "rent", template_name: "שכירות", amount: 5000, expense_day_of_month: 10 }),
  tpl({ id: "arnona", template_name: "ארנונה", amount: 300, expense_day_of_month: 2 }),
  tpl({ id: "vat", template_name: "מע״מ", amount: 1000, is_variable_amount: true, expense_day_of_month: 20 }),
];
const sources = [
  src({ kind: "loan", key: "L1", name: "החזר הלוואה — ברנדווין", nextDate: "2026-10-01", amount: 157200, monthly: false }),
  src({ kind: "card", key: "ויזה", name: "חיוב כרטיס: ויזה", nextDate: "2026-10-03", amount: null, monthly: false }),
  src({ kind: "salary", key: "u1", name: "משכורת דוד", nextDate: "2026-10-12", amount: 8000, monthly: true }),
  src({ kind: "salary", key: "u2", name: "משכורת נתן", nextDate: "2026-10-14", amount: null, monthly: false }),
  src({ kind: "loan", key: "L2", name: "החזר הלוואה — רוזנפלד", nextDate: "2026-09-18", amount: 5000, monthly: true }),
];

describe("buildFixedPaymentRows", () => {
  it("orders bills and sources together by the day of the month the money leaves", () => {
    const rows = buildFixedPaymentRows(templates, sources, today);
    expect(rows.map((r) => (r.kind === "template" ? r.template.template_name : r.source.name))).toEqual([
      "החזר הלוואה — ברנדווין", // 1
      "ארנונה", // 2
      "חיוב כרטיס: ויזה", // 3
      "שכירות", // 10
      "משכורת דוד", // 12
      "משכורת נתן", // 14
      "החזר הלוואה — רוזנפלד", // 18
      "מע״מ", // 20
    ]);
  });

  it("puts a source with no next date last", () => {
    const rows = buildFixedPaymentRows([], [src({ key: "a", nextDate: null }), src({ key: "b", nextDate: "2026-09-28" })], today);
    expect(rows.map((r) => (r.kind === "source" ? r.source.key : ""))).toEqual(["b", "a"]);
  });
});

// Local calendar date of a timestamp (the helper works in local time, and
// toISOString would shift a local midnight to the previous UTC day).
function localDay(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("templateNextPaymentTime", () => {
  it("a yearly bill in March, seen in September, is next March", () => {
    const t = tpl({ frequency: "yearly", expense_month_of_year: 3, expense_day_of_month: 15 });
    expect(localDay(templateNextPaymentTime(t, today))).toBe("2027-03-15");
  });

  it("an every-two-months bill anchored in January skips the off-phase month", () => {
    const t = tpl({ interval_months: 2, start_date: "2026-01-10", expense_day_of_month: 10 });
    // Sep is on phase (8 months after Jan) but its 10th has passed → Nov 10.
    expect(localDay(templateNextPaymentTime(t, today))).toBe("2026-11-10");
  });
});

describe("summarizeFixedPayments — the monthly pill", () => {
  it("sums fixed bills + monthly salaries + monthly loans; counts (never sums) one-off loans, hourly workers, cards and variable bills", () => {
    const s = summarizeFixedPayments(templates, sources);
    expect(s.monthlyTotal).toBe(5000 + 300 + 8000 + 5000);
    expect(s).toMatchObject({
      activeCount: 3,
      variableCount: 1,
      sourceCount: 5,
      monthlySourceCount: 2,
      oneOffLoanCount: 1,
      hourlyCount: 1,
      cardCount: 1,
    });
  });

  it("respects the active predicate and normalizes yearly / every-N bills to a month", () => {
    const yearly = tpl({ id: "ins", template_name: "ביטוח", amount: 1200, frequency: "yearly", expense_month_of_year: 1 });
    const quarterly = tpl({ id: "q", template_name: "רבעוני", amount: 300, interval_months: 3 });
    const off = tpl({ id: "off", template_name: "כבוי", amount: 999, is_active: false });
    const s = summarizeFixedPayments([yearly, quarterly, off], sources, (x) => x.key !== "L2");
    expect(s.monthlyTotal).toBe(100 + 100 + 8000);
    expect(s.activeCount).toBe(2);
    expect(s.sourceCount).toBe(4);
  });
});

describe("summarizeFixedPayments — incoming sources", () => {
  // The list shows rent and loans-given as monthly income; the summary above it
  // has to count those, not the outgoing bills the list is hiding.
  const inflow = (over: Partial<OutflowSourceRow> & { kind: OutflowSourceRow["kind"]; key: string }): OutflowSourceRow => ({
    name: "x", scheduleLabel: "", nextDate: "2099-01-10", focusId: null, amount: null, href: "/",
    reminderWorkDaysBefore: null, effectiveReminderDays: 0, accountId: null, isActive: true,
    settled: false, monthly: true, direction: "in", configurable: false,
    ...over,
  });

  it("sums monthly rent with no templates in the mix", () => {
    const s = summarizeFixedPayments([], [
      inflow({ kind: "rent", key: "L1", amount: 4000 }),
      inflow({ kind: "rent", key: "L2", amount: 3300 }),
    ]);
    expect(s.monthlyTotal).toBe(7300);
    expect(s.monthlySourceCount).toBe(2);
    expect(s.activeCount).toBe(0);
  });

  it("leaves the clearing deposit out, like a card charge — the amount isn't known ahead", () => {
    const s = summarizeFixedPayments([], [
      inflow({ kind: "rent", key: "L1", amount: 4000 }),
      inflow({ kind: "settlement", key: "grow", amount: null, monthly: false }),
    ]);
    expect(s.monthlyTotal).toBe(4000);
    expect(s.cardCount).toBe(1);
  });

  it("counts a one-off repayment on a loan given as not monthly", () => {
    const s = summarizeFixedPayments([], [
      inflow({ kind: "loan_in", key: "L9", amount: 50000, monthly: false }),
    ]);
    expect(s.monthlyTotal).toBe(0);
    expect(s.oneOffLoanCount).toBe(1);
  });
});
