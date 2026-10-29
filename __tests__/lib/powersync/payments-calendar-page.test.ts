import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalSupabase, type LocalReader } from "@/lib/powersync/local-supabase";
import { CALENDAR_PAGE_NOT_READY, computeLocalCard, LOCAL_CARD_TABLES } from "@/lib/powersync/dashboard-local";
import { AppSchema } from "@/lib/powersync/schema";

// The payments calendar (/financial/payments-calendar, צפי תזרים) from the
// device copy (owner, 2026-10-29: "yes go ahead with 1-3"): the server's own
// code (loadPaymentsCalendarView) run on the device's copy — both directions,
// the recurring rules, the dialogs' lists — only from a copy with sync rules
// v1.15 (the payment promises, the recurring bills' whole rule), every read
// done (a gap would be a wrong total with nothing to say so).

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

/**
 * An admin's copy on 2026-10-29: the electricity bill (350 a month, on the
 * 10th, tied to a property), an unpaid plumber's bill from last week, a move
 * still owed 400, a rent lease, and a promise of 250 for 5/11.
 */
function copy(overrides: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    business_settings: [{ id: "true", vat_rate: "0.18", money_tables: 1, bank_tables: 1, calendar_tables: 1 }],
    users: [{ id: "admin", full_name: "מנהל", role: "admin", active: 1, system_access: 1, auth_user_id: "auth-admin" }],
    accounts: [{ id: "a1", name: "מזרחי עסקי", kind: "bank", currency: "ILS", opening_balance: "0", opening_date: "2026-07-01", is_active: 1 }],
    customers: [
      { id: "c1", name: "משה כהן", active: 1 },
      { id: "c2", name: "דוד לוי", active: 1 },
    ],
    projects: [
      { id: "p1", name: "הובלה", customer_id: "c1", status: "active", project_type: "logistics", agreed_base_price: "1000", created_at: "2026-09-25 08:00:00.000Z", updated_at: "2026-09-25 08:00:00.000Z" },
    ],
    payments: [
      { id: "pay1", project_id: "p1", account_id: "a1", amount_total: "600", payment_status: "cleared", payment_date: "2026-10-01 00:00:00.000Z", payment_method: "bank_transfer", business_domain: "logistics_projects", created_at: "2026-10-01 09:00:00.000Z", recorded_by: "admin" },
    ],
    expenses: [
      { id: "e1", account_id: "a1", amount: "480", payment_status: "not_paid", expense_date: "2026-10-22 00:00:00.000Z", category: "אינסטלטור", business_domain: "general_business", created_at: "2026-10-22 09:00:00.000Z", recorded_by: "admin" },
    ],
    properties: [{ id: "pr1", name: "גבעון 5", address: "גבעון 5", is_active: 1 }],
    lease_agreements: [{ id: "l1", property_id: "pr1", customer_id: "c2", start_date: "2026-07-01", monthly_rent_amount: "2000", status: "active" }],
    recurring_expense_templates: [
      {
        id: "rt1", template_name: "חשמל", category: "חשמל", amount: "350", frequency: "monthly", interval_months: 1, expense_day_of_month: 10,
        create_day_of_month: 3, is_active: 1, business_domain: "property_management", property_id: "pr1", billed_to_customer: 0,
        included_in_base_price: 0, start_date: "2026-07-01", created_at: "2026-07-01 09:00:00.000Z",
      },
    ],
    payment_promises: [
      { id: "pp1", customer_id: "c1", project_id: "p1", amount: "250", promised_date: "2026-11-05", status: "pending", currency: "ILS", created_at: "2026-10-28 09:00:00.000Z" },
    ],
    ...overrides,
  };
}

async function calendar(tables: Record<string, Row[]>) {
  const { reader, read } = fakeReader(tables);
  const card = await computeLocalCard(createLocalSupabase(reader), "paymentsCalendar", viewer, undefined);
  return { card, read };
}

describe("the payments calendar from the device", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T09:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("money going out: the unpaid plumber's bill, and next month's electricity forecast from its rule", async () => {
    const { card } = await calendar(copy());
    expect(card.error).toBeNull();
    expect(card.todayIso).toBe("2026-10-29");
    const out = card.items.filter((item) => item.direction === "out");
    expect(out.find((item) => item.expenseId === "e1")).toMatchObject({ amount: 480, date: "2026-10-22" });
    const electricity = out.filter((item) => item.recurringTemplateId === "rt1");
    expect(electricity.map((item) => item.date)).toContain("2026-11-10");
    // Labelled by the bill's name, as the קבועות list.
    expect(electricity.every((item) => item.label === "חשמל")).toBe(true);
  });

  it("money coming in: the promise of 250 on its day", async () => {
    const { card } = await calendar(copy());
    const incoming = card.items.filter((item) => item.direction === "in");
    expect(incoming.some((item) => item.amount === 250 && item.date === "2026-11-05")).toBe(true);
  });

  it("the קבועות tab's rule whole: its property, the day it's made, the billing flags", async () => {
    const { card } = await calendar(copy());
    expect(card.templates).toEqual([
      expect.objectContaining({ id: "rt1", template_name: "חשמל", property_id: "pr1", create_day_of_month: 3, expense_day_of_month: 10, billed_to_customer: false, included_in_base_price: false, is_active: true }),
    ]);
  });

  it("the dialogs' lists: projects with their customer, active properties, the accounts", async () => {
    const { card } = await calendar(copy());
    expect(card.projects).toEqual([{ id: "p1", label: "הובלה (משה כהן)" }]);
    expect(card.properties).toEqual([{ id: "pr1", label: "גבעון 5" }]);
    expect(card.incomeOptions.projects).toEqual([{ id: "p1", name: "הובלה", customerName: "משה כהן" }]);
    expect(card.accounts.map((account) => account.id)).toEqual(["a1"]);
  });

  it("every table it reads is one the page watches — a change to any of them draws it again", async () => {
    const { read } = await calendar(copy());
    const watched = new Set(LOCAL_CARD_TABLES.paymentsCalendar);
    expect([...read].filter((table) => !watched.has(table))).toEqual([]);
  });

  it("not from a copy synced before v1.15 (no promises: an incoming side short of them, with nothing to say so)", async () => {
    const before = copy({ business_settings: [{ id: "true", vat_rate: "0.18", money_tables: 1, bank_tables: 1 }] });
    await expect(calendar(before)).rejects.toThrow(CALENDAR_PAGE_NOT_READY);
  });

  it("a read the device can't do refuses the page — even the promises, which the loader would quietly skip", async () => {
    const promises = fakeReader(copy(), { failOn: "payment_promises" });
    await expect(computeLocalCard(createLocalSupabase(promises.reader), "paymentsCalendar", viewer, undefined)).rejects.toThrow(
      /a read failed on the device — .*payment_promises/
    );
  });

  it("the daily check's second look on the server's data: no device copy marks asked", async () => {
    const serverData = copy({ business_settings: [{ id: "true", vat_rate: "0.18" }] });
    const { reader } = fakeReader(serverData);
    const card = await computeLocalCard(createLocalSupabase(reader), "paymentsCalendar", viewer, undefined, { onServer: true });
    expect(card.items.length).toBeGreaterThan(0);
  });
});
