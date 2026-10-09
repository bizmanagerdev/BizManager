import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalSupabase, type LocalReader } from "@/lib/powersync/local-supabase";
import { computeLocalCard, MONEY_CARD_NOT_READY } from "@/lib/powersync/dashboard-local";
import { AppSchema } from "@/lib/powersync/schema";

// The dashboard's money cards from the device copy (sync rules v1.8): the
// server's own loaders, run on the copy, every read of theirs answered —
// a read the device can't do refuses the card rather than leaving a gap in a
// figure — and only from a copy that has the money tables.

type Row = Record<string, unknown>;

/** Every column of each device table (a real copy's rows carry them all, null when empty). */
const COLUMNS = new Map(AppSchema.tables.map((table) => [table.name, table.columns.map((column) => column.name)]));
const padded = (table: string, row: Row): Row => ({
  ...Object.fromEntries((COLUMNS.get(table) ?? []).map((column) => [column, null])),
  ...row,
});

/** A fake device database: rows as PowerSync stores them (1/0, numeric text). */
function fakeReader(tables: Record<string, Row[]>, { failOn }: { failOn?: string } = {}): LocalReader {
  return {
    async getAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const match = /^SELECT \* FROM ([a-z_]+)(?: WHERE (.*))?$/.exec(sql);
      if (!match) throw new Error(`fake reader can't run: ${sql}`);
      if (match[1] === failOn) throw new Error(`no such table: ${failOn}`);
      let rows = (tables[match[1]] ?? []).map((row) => padded(match[1], row));
      if (match[2]) {
        let p = 0;
        for (const clause of match[2].split(" AND ")) {
          const eq = /^([a-z_]+) = \?$/.exec(clause);
          const inList = /^([a-z_]+) IN \(([?,]+)\)$/.exec(clause);
          if (eq) {
            const value = params[p++];
            rows = rows.filter((r) => r[eq[1]] === value);
          } else if (inList) {
            const n = inList[2].split(",").length;
            const values = params.slice(p, p + n);
            p += n;
            rows = rows.filter((r) => values.includes(r[inList[1]]));
          } else {
            throw new Error(`fake reader can't filter: ${clause}`);
          }
        }
      }
      return rows.map((r) => ({ ...r })) as T[];
    },
  };
}

const viewer = { userId: "admin", role: "admin", locale: "he" as const };

/** A small business, as an admin's copy holds it on 2026-10-07. */
function copy(overrides: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    business_settings: [{ id: "true", vat_rate: "0.18", books_start_date: null, money_tables: 1 }],
    users: [
      { id: "admin", full_name: "מנהל", email: "a@x", role: "admin", active: 1, system_access: 1, auth_user_id: "auth-admin" },
      { id: "w1", full_name: "עובד", email: "w@x", role: "worker", active: 1, system_access: 1, auth_user_id: "auth-w1", pay_tracking_mode: "hourly" },
    ],
    customers: [
      { id: "c1", name: " משה כהן ", name_for_invoice: null, phone: "050-1234567", whatsapp: " ", active: 1 },
      { id: "c2", name: "   ", name_for_invoice: "חברת בע\"מ", phone: null, whatsapp: "052-7654321", active: 1 },
    ],
    orders: [
      // 1,000 ordered, 400 paid, 600 pending — due 2026-10-01 (overdue).
      { id: "o1", customer_id: "c1", order_date: "2026-09-20", status: "confirmed", total_amount: "1000", payment_status: "partial", created_at: "2026-09-20T08:00:00Z" },
      // Fully paid: nothing to collect.
      { id: "o2", customer_id: "c2", order_date: "2026-10-02", status: "delivered", total_amount: "300", payment_status: "paid", created_at: "2026-10-02T08:00:00Z" },
      // Cancelled: never on the worklist.
      { id: "o3", customer_id: "c2", order_date: "2026-10-03", status: "cancelled", total_amount: "900", payment_status: "unpaid", created_at: "2026-10-03T08:00:00Z" },
    ],
    projects: [
      // A move for 5,000 (before VAT) — 2,000 paid, 1,000 due today.
      { id: "p1", name: "הובלה", customer_id: "c2", agreed_base_price: "5000", actual_price: null, price_includes_vat: 0, status: "active", start_date: "2026-10-01", created_at: "2026-09-25T08:00:00Z" },
    ],
    payments: [
      { id: "pay1", order_id: "o1", amount_total: "400", payment_status: "cleared", payment_date: "2026-09-21T10:00:00Z", due_date: null, payment_method: "cash", business_domain: "sales" },
      { id: "pay2", order_id: "o1", amount_total: "600", payment_status: "pending", payment_date: null, due_date: "2026-10-01", payment_method: "check", check_number: "1001" },
      { id: "pay3", order_id: "o2", amount_total: "300", payment_status: "cleared", payment_date: "2026-10-02T10:00:00Z", payment_method: "credit_card", business_domain: "sales" },
      { id: "pay4", project_id: "p1", amount_total: "2000", payment_status: "cleared", payment_date: "2026-10-04T10:00:00Z", payment_method: "bank_transfer", business_domain: "logistics_projects" },
      { id: "pay5", project_id: "p1", amount_total: "1000", payment_status: "pending", payment_date: null, due_date: "2026-10-07", payment_method: "check", check_number: "77" },
    ],
    expenses: [
      // Rent, unpaid since the 3rd — late.
      { id: "e-late", expense_date: "2026-10-03", amount: "2500", category: "rent", business_domain: "general_business", payment_status: "not_paid", paid_amount: "0", recorded_by: "admin", created_at: "2026-10-01T08:00:00Z" },
      // Fuel, paid on the 5th — this month's money out.
      { id: "e-paid", expense_date: "2026-10-05", amount: "300", category: "fuel", business_domain: "logistics_projects", payment_status: "paid", paid_amount: "300", paid_date: "2026-10-05", payment_method: "credit_card", recorded_by: "admin", created_at: "2026-10-05T08:00:00Z" },
    ],
    project_expenses: [],
    attendance_sessions: [],
    payslips: [],
    payroll_periods: [],
    salary_agreements: [],
    worker_payments: [],
    worker_payment_allocations: [],
    recurring_expense_templates: [
      // Electricity on the 12th, its heads-up 5 work-days before (open from the 5th).
      { id: "tpl1", template_name: "חשמל", category: "utilities", amount: "1200", is_variable_amount: 0, auto_paid: 0, business_domain: "general_business", frequency: "monthly", interval_months: 1, expense_day_of_month: 12, start_date: "2026-01-01", end_date: null, is_active: 1, reminder_work_days_before: 5, created_at: "2026-01-01T08:00:00Z", created_by: "admin" },
    ],
    loans: [],
    loan_repayments: [],
    card_statement_charges: [],
    card_statement_rows: [],
    card_settlement_confirmations: [],
    outflow_source_settings: [],
    ...overrides,
  };
}

describe("the dashboard's money cards from the device", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T09:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("collections_view: what's left to collect per order and project, with the customer's trimmed name and numbers", async () => {
    const local = createLocalSupabase(fakeReader(copy()));
    const { data, error } = await local.from("collections_view").select("*").order("source_id");
    expect(error).toBeNull();
    expect(data).toEqual([
      expect.objectContaining({
        source_type: "order",
        source_id: "o1",
        collection_key: "order:o1",
        customer_name: "משה כהן",
        customer_phone: "050-1234567",
        customer_whatsapp: null,
        business_domain: "sales",
        reference_date: "2026-09-20",
        total_amount: 1000,
        collected_amount: 400,
        pending_amount: 600,
        overdue_amount: 600,
        outstanding_amount: 600,
        next_due_date: "2026-10-01",
        last_payment_date: "2026-09-21",
        collection_status: "overdue",
      }),
      expect.objectContaining({
        source_type: "project",
        source_id: "p1",
        customer_name: 'חברת בע"מ',
        customer_phone: null,
        customer_whatsapp: "052-7654321",
        business_domain: "logistics_projects",
        total_amount: 5000,
        collected_amount: 2000,
        pending_amount: 1000,
        overdue_amount: 1000,
        outstanding_amount: 3000,
        next_due_date: "2026-10-07",
        collection_status: "overdue",
      }),
    ]);
  });

  it("works out all three cards, every read answered — the same figures the server's loaders make of these rows", async () => {
    const local = createLocalSupabase(fakeReader(copy()));
    const [payments, collections, chart] = await Promise.all([
      computeLocalCard(local, "payments", viewer),
      computeLocalCard(local, "collections", viewer),
      computeLocalCard(local, "domainChart", viewer),
    ]);

    // Payments: last month's electricity and the rent unpaid since the 3rd are
    // late (oldest first); this month's electricity (the 12th) is expected —
    // its heads-up, 5 work-days before, opened on the 5th.
    expect(payments.late.map((i) => [i.id, i.date, i.amount])).toEqual([
      ["recur_proj:tpl1:2026-09", "2026-09-12", 1200],
      ["expense:e-late", "2026-10-03", 2500],
    ]);
    expect(payments.lateTotal).toBe(3700);
    expect(payments.upcoming.map((i) => [i.id, i.date, i.amount])).toEqual([["recur_proj:tpl1:2026-10", "2026-10-12", 1200]]);
    expect(payments.today).toEqual([]);

    // Collections, by /collections' own rule: today's check from the project;
    // the project's unpaid 3,000 (the 1,000 check due today and the 2,000
    // nobody has registered) late since it started on the 1st; the order's
    // overdue check not late at all — an open order never is.
    expect(collections.today.map((p) => [p.id, p.amount, p.customer_name])).toEqual([["pay5", 1000, 'חברת בע"מ']]);
    expect(collections.late.map((d) => [d.customerName, d.amount, d.daysLate])).toEqual([['חברת בע"מ', 3000, 6]]);
    expect(collections.lateTotal).toBe(3000);
    expect(collections.upcoming).toEqual([]);

    // The chart: October's money in and out per business domain, September's
    // as the ghost bars. The card sale (2nd) counts when the card company
    // settles it, not before.
    expect(chart).toEqual({
      initialMonth: "2026-10",
      todayIso: "2026-10-07",
      booksStartDate: null,
      initialBars: [
        { name: "פרויקטים", inflow: 2000, outflow: 300, prevInflow: 0, prevOutflow: 0 },
        { name: "מכירות", inflow: 0, outflow: 0, prevInflow: 400, prevOutflow: 0 },
      ],
    });
  });

  it("a copy without the money tables (before sync rules v1.8): not this card's to draw", async () => {
    const withoutMarker = copy({ business_settings: [{ id: "true", vat_rate: "0.18" }] });
    await expect(computeLocalCard(createLocalSupabase(fakeReader(withoutMarker)), "payments", viewer)).rejects.toThrow(
      MONEY_CARD_NOT_READY
    );
  });

  it("a read the device can't do refuses the card — never a figure with a gap in it", async () => {
    const local = createLocalSupabase(fakeReader(copy(), { failOn: "loans" }));
    await expect(computeLocalCard(local, "payments", viewer)).rejects.toThrow(/a read failed on the device — loans/);
    await expect(computeLocalCard(local, "domainChart", viewer)).rejects.toThrow(/a read failed on the device — loans/);
  });
});

describe("the dashboard's collections card", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T09:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the orders nobody has registered a payment for, as /collections does (it used to miss them)", async () => {
    const local = createLocalSupabase(
      fakeReader(
        copy({
          orders: [
            // Delivered on the 1st, nothing paid or registered: late since.
            { id: "o9", customer_id: "c1", order_date: "2026-10-01", status: "delivered", total_amount: "800", payment_status: "unpaid", created_at: "2026-10-01T08:00:00Z" },
            // Delivered, to be paid at the end of next month: expected.
            { id: "o10", customer_id: "c2", order_date: "2026-10-05", status: "delivered", total_amount: "500", payment_status: "unpaid", due_date: "2026-11-30", created_at: "2026-10-05T08:00:00Z" },
            // Still open (a draft): not chased yet.
            { id: "o11", customer_id: "c2", order_date: "2026-09-01", status: "draft", total_amount: "700", payment_status: "unpaid", created_at: "2026-09-01T08:00:00Z" },
          ],
          projects: [],
          payments: [],
        })
      )
    );
    const card = await computeLocalCard(local, "collections", viewer);
    expect(card.late.map((d) => [d.customerName, d.amount, d.daysLate, d.sources])).toEqual([["משה כהן", 800, 6, 1]]);
    expect(card.upcoming.map((d) => [d.customerName, d.amount])).toEqual([['חברת בע"מ', 500]]);
  });
});
