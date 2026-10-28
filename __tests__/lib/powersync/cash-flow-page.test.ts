import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalSupabase, type LocalReader } from "@/lib/powersync/local-supabase";
import { computeLocalCard, LOCAL_CARD_TABLES, MONEY_CARD_NOT_READY } from "@/lib/powersync/dashboard-local";
import { AppSchema } from "@/lib/powersync/schema";
import { cashFlowViewFilters } from "@/lib/financial/cashFlowPage";

// The cash-flow page (/financial, תזרים) from the device copy (owner,
// 2026-10-28: "go on with תזרים … be very very cautious this is the money"):
// the server's own code (loadCashFlowFlowView → getFinancialPageData) run on the
// device's copy — every row of the flow view and the dialogs' lists — and only
// from a copy that has the money tables, every read done (a gap would be a
// wrong total with nothing to say so).

type Row = Record<string, unknown>;

const COLUMNS = new Map(AppSchema.tables.map((table) => [table.name, table.columns.map((column) => column.name)]));

/** A fake device database read whole per table, as the app's engine does; it notes every table read. */
function fakeReader(tables: Record<string, Row[]>, { failOn }: { failOn?: string } = {}) {
  const read = new Set<string>();
  const reader: LocalReader = {
    tableVersion: () => 0,
    async getAll<T>(sql: string): Promise<T[]> {
      const match = /^SELECT \* FROM ([a-z_]+)$/.exec(sql);
      if (!match) throw new Error(`fake reader can't run: ${sql}`);
      read.add(match[1]);
      if (match[1] === failOn) throw new Error(`no such table: ${failOn}`);
      return (tables[match[1]] ?? []).map((row) => ({
        ...Object.fromEntries((COLUMNS.get(match[1]) ?? []).map((column) => [column, null])),
        ...row,
      })) as T[];
    },
  };
  return { reader, read };
}

const viewer = { userId: "admin", role: "admin", locale: "he" as const };

/** An admin's copy on 2026-10-28: a move (price 1,000, 600 collected, 200 truck), a sale, rent, a worker, a loan, a recurring bill. */
function copy(overrides: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    business_settings: [{ id: "true", vat_rate: "0.18", money_tables: 1, bank_tables: 1 }],
    users: [
      { id: "admin", full_name: "מנהל", role: "admin", active: 1, system_access: 1, auth_user_id: "auth-admin" },
      { id: "w1", full_name: "סאלח", role: "worker", active: 1, system_access: 1, auth_user_id: "auth-w1" },
    ],
    accounts: [{ id: "a1", name: "מזרחי עסקי", kind: "bank", currency: "ILS", opening_balance: "0", opening_date: "2026-07-01", is_active: 1 }],
    customers: [
      { id: "c1", name: "משה כהן", phone: "050-1234567", active: 1 },
      { id: "c2", name: "דוד לוי", active: 1 },
    ],
    projects: [
      { id: "p1", name: "הובלה", customer_id: "c1", status: "active", project_type: "logistics", agreed_base_price: "1000", created_at: "2026-09-25 08:00:00.000Z", updated_at: "2026-09-25 08:00:00.000Z" },
    ],
    orders: [{ id: "o1", customer_id: "c2", status: "delivered", order_date: "2026-10-10", total_amount: "300", created_at: "2026-10-10 09:00:00.000Z" }],
    payments: [
      { id: "pay1", project_id: "p1", account_id: "a1", amount_total: "600", payment_status: "cleared", payment_date: "2026-10-01 00:00:00.000Z", payment_method: "bank_transfer", business_domain: "logistics_projects", created_at: "2026-10-01 09:00:00.000Z", recorded_by: "admin" },
      { id: "pay2", order_id: "o1", account_id: "a1", amount_total: "300", payment_status: "cleared", payment_date: "2026-10-12 00:00:00.000Z", payment_method: "cash", business_domain: "sales", created_at: "2026-10-12 09:00:00.000Z", recorded_by: "admin" },
    ],
    expenses: [
      { id: "e1", project_id: "p1", account_id: "a1", amount: "200", payment_status: "paid", expense_date: "2026-10-05 00:00:00.000Z", category: "משאית", business_domain: "logistics_projects", payment_method: "cash", created_at: "2026-10-05 09:00:00.000Z", recorded_by: "admin" },
    ],
    project_expenses: [{ id: "pe1", expense_id: "e1", project_id: "p1", included_in_base_price: 1, billed_to_customer: 0 }],
    properties: [{ id: "pr1", name: "גבעון 5", address: "גבעון 5", is_active: 1 }],
    lease_agreements: [{ id: "l1", property_id: "pr1", customer_id: "c2", start_date: "2026-07-01", monthly_rent_amount: "2000", status: "active" }],
    attendance_sessions: [{ id: "s1", user_id: "w1", clock_in: "2026-10-20 06:00:00.000Z", clock_out: "2026-10-20 14:00:00.000Z", worked_minutes: 480, project_id: "p1", business_domain: "logistics_projects", labor_cost: "400" }],
    worker_payments: [{ id: "wp1", user_id: "w1", payment_date: "2026-10-21", amount: "150", payment_method: "cash", account_id: "a1", created_at: "2026-10-21 09:00:00.000Z", recorded_by: "admin" }],
    loans: [{ id: "ln1", direction: "taken", lender: "אבא", loan_date: "2026-10-02", amount: "5000", account_id: "a1", status: "active", created_at: "2026-10-02 09:00:00.000Z" }],
    recurring_expense_templates: [{ id: "rt1", template_name: "חשמל", category: "חשמל", amount: "350", frequency: "monthly", interval_months: 1, expense_day_of_month: 10, is_active: 1, business_domain: "general_business", start_date: "2026-07-01", created_at: "2026-07-01 09:00:00.000Z" }],
    ...overrides,
  };
}

async function cashFlow(tables: Record<string, Row[]>, params: Record<string, string> = {}) {
  const { reader, read } = fakeReader(tables);
  const card = await computeLocalCard(createLocalSupabase(reader), "cashFlow", viewer, cashFlowViewFilters(params));
  return { card, read };
}

describe("the cash-flow page from the device", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T09:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("what came in and went out, what's still owed on the move, and every row of it", async () => {
    const { card } = await cashFlow(copy());
    const byId = new Map(card.data.ledgerEntries.map((entry) => [entry.id, entry]));
    // The move's 600 and the sale's 300 in; the truck's 200 out.
    expect([byId.get("payment:pay1")?.amount, byId.get("payment:pay2")?.amount, byId.get("expense:e1")?.amount]).toEqual([600, 300, 200]);
    expect([byId.get("payment:pay1")?.type, byId.get("expense:e1")?.type]).toEqual(["inflow", "outflow"]);
    // 1,000 agreed, 600 collected: 400 still expected from the move.
    expect(byId.get("project-receivable:p1")).toMatchObject({ type: "inflow", amount: 400 });
    // The flow page's shape: every row (nothing sent in parts), none of the reports-only data.
    expect(card.data.ledgerEntries.length).toBe(card.data.ledgerTotalCount);
    expect(card.data.profitLoss).toEqual([]);
    expect(card.data.monthlyTrend).toEqual([]);
  });

  it("the expense dialogs' lists: projects with their customer, active properties", async () => {
    const { card } = await cashFlow(copy());
    expect(card.options.projects).toEqual([{ id: "p1", label: "הובלה (משה כהן)" }]);
    expect(card.options.properties).toEqual([{ id: "pr1", label: "גבעון 5" }]);
  });

  it("the orders list: newest first, one day's orders by id — the server's order exactly — and the day only", async () => {
    const order = (id: string, customer_id: string, order_date: string) => ({
      id, customer_id, status: "delivered", order_date, total_amount: "100", created_at: `${order_date} 09:00:00.000Z`,
    });
    const { card } = await cashFlow(
      copy({ orders: [order("o1", "c2", "2026-10-10"), order("o3", "c1", "2026-10-12"), order("o2", "c1", "2026-10-12")] })
    );
    expect(card.options.orders).toEqual([
      { id: "o2", label: "הזמנה o2 (משה כהן • 2026-10-12)" },
      { id: "o3", label: "הזמנה o3 (משה כהן • 2026-10-12)" },
      { id: "o1", label: "הזמנה o1 (דוד לוי • 2026-10-10)" },
    ]);
  });

  it("the address's filters: only money out", async () => {
    const { card } = await cashFlow(copy(), { type: "outflow" });
    expect(card.filters.filters.type).toBe("outflow");
    expect(card.data.ledgerEntries.length).toBeGreaterThan(0);
    expect(card.data.ledgerEntries.every((entry) => entry.type === "outflow")).toBe(true);
    expect(card.data.ledgerEntries.map((entry) => entry.id)).toContain("expense:e1");
  });

  it("every table it reads is one the page watches — a change to any of them draws it again", async () => {
    const { read } = await cashFlow(copy());
    const watched = new Set(LOCAL_CARD_TABLES.cashFlow);
    expect([...read].filter((table) => !watched.has(table))).toEqual([]);
  });

  it("not from a copy synced before the money tables (it would read as no loans, no card charges)", async () => {
    const before = copy({ business_settings: [{ id: "true", vat_rate: "0.18" }] });
    await expect(cashFlow(before)).rejects.toThrow(MONEY_CARD_NOT_READY);
  });

  it("a read the device can't do refuses the page rather than drawing a total with a gap", async () => {
    const workers = fakeReader(copy(), { failOn: "worker_payments" });
    await expect(computeLocalCard(createLocalSupabase(workers.reader), "cashFlow", viewer, cashFlowViewFilters({}))).rejects.toThrow();
  });

  it("…even one its loader would swallow: the rent roll (counted the old way without it) still refuses the page", async () => {
    const rent = fakeReader(copy(), { failOn: "lease_agreements" });
    await expect(computeLocalCard(createLocalSupabase(rent.reader), "cashFlow", viewer, cashFlowViewFilters({}))).rejects.toThrow(
      /a read failed on the device — .*lease_agreements/
    );
  });

  it("the daily check's second look on the server's data: no device copy marks asked", async () => {
    const serverData = copy({ business_settings: [{ id: "true", vat_rate: "0.18" }] });
    const { reader } = fakeReader(serverData);
    const card = await computeLocalCard(createLocalSupabase(reader), "cashFlow", viewer, cashFlowViewFilters({}), { onServer: true });
    expect(card.data.ledgerEntries.length).toBeGreaterThan(0);
  });
});
