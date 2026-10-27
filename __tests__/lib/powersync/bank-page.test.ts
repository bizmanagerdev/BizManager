import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalSupabase, type LocalReader } from "@/lib/powersync/local-supabase";
import { BANK_PAGE_NOT_READY, computeLocalCard } from "@/lib/powersync/dashboard-local";
import { AppSchema } from "@/lib/powersync/schema";

// The accounts page (/financial/bank) from the device copy (sync rules v1.14):
// the server's own loader (loadBankPage) run on the copy — every account's
// balance and register, the "נבדק מול הבנק" ticks, a "מול מזומן" line's card
// row, a project expense's billing flags, today's rates and the quick line's
// filing — and only from a copy that has the accounts tables. Checked against
// the live data on 2026-10-27: 13 accounts, 1,233 register rows, 23 loans, no
// difference.

type Row = Record<string, unknown>;

const COLUMNS = new Map(AppSchema.tables.map((table) => [table.name, table.columns.map((column) => column.name)]));

/** A fake device database, read whole per table as the app's engine does: rows as PowerSync stores them (1/0, numeric text). */
function fakeReader(tables: Record<string, Row[]>, { failOn }: { failOn?: string } = {}): LocalReader {
  return {
    tableVersion: () => 0,
    async getAll<T>(sql: string): Promise<T[]> {
      const match = /^SELECT \* FROM ([a-z_]+)$/.exec(sql);
      if (!match) throw new Error(`fake reader can't run: ${sql}`);
      if (match[1] === failOn) throw new Error(`no such table: ${failOn}`);
      return (tables[match[1]] ?? []).map((row) => ({
        ...Object.fromEntries((COLUMNS.get(match[1]) ?? []).map((column) => [column, null])),
        ...row,
      })) as T[];
    },
  };
}

const viewer = { userId: "admin", role: "admin", locale: "he" as const };

/** An admin's copy on 2026-10-27: a bank account and the cash box. */
function copy(overrides: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    business_settings: [{ id: "true", vat_rate: "0.18", books_start_date: null, money_tables: 1, bank_tables: 1 }],
    users: [{ id: "admin", full_name: "מנהל", role: "admin", active: 1, system_access: 1, auth_user_id: "auth-admin" }],
    accounts: [
      { id: "a1", name: "מזרחי עסקי", kind: "bank", currency: "ILS", opening_balance: "1000", opening_date: "2026-07-01", is_active: 1, sort_order: 1 },
      { id: "a2", name: "מזומן", kind: "cash", currency: "ILS", opening_balance: "0", opening_date: "2026-07-01", is_active: 1, sort_order: 2 },
    ],
    customers: [{ id: "c1", name: "משה כהן", phone: "050-1234567", active: 1 }],
    projects: [{ id: "p1", name: "הובלה", customer_id: "c1", status: "active", created_at: "2026-09-25 08:00:00.000Z" }],
    payments: [
      // 500 into the bank on Oct 1, ticked as checked against the bank.
      { id: "pay1", account_id: "a1", amount_total: "500", payment_status: "cleared", payment_date: "2026-10-01 00:00:00.000Z", payment_method: "bank_transfer", business_domain: "sales", created_at: "2026-10-01 09:00:00.000Z", recorded_by: "admin" },
    ],
    expenses: [
      // 200 cash for the move, included in its base price.
      { id: "e1", account_id: "a2", amount: "200", payment_status: "paid", expense_date: "2026-10-05 00:00:00.000Z", category: "משאית", project_id: "p1", business_domain: "logistics_projects", payment_method: "cash", created_at: "2026-10-05 09:00:00.000Z", recorded_by: "admin" },
    ],
    project_expenses: [{ id: "pe1", expense_id: "e1", project_id: "p1", included_in_base_price: 1, billed_to_customer: 0 }],
    account_transfers: [
      // 300 taken out of the bank into the cash box.
      { id: "tr1", from_account_id: "a1", to_account_id: "a2", amount: "300", transfer_date: "2026-10-10", created_at: "2026-10-10 09:00:00.000Z" },
      // A card purchase paid back in cash (מול מזומן): its card line names it.
      { id: "tr2", from_account_id: null, to_account_id: "a2", amount: "50", transfer_date: "2026-10-12", card_statement_row_id: "cr1", created_at: "2026-10-12 09:00:00.000Z" },
    ],
    card_statement_rows: [{ id: "cr1", statement_id: "st1", card_label: "ויזה", description: "קניות", expense_id: null }],
    account_ledger_checks: [{ id: "chk1", account_id: "a1", entry_key: "p:pay1", amount_at_check: "500", date_at_check: "2026-10-01" }],
    fx_rates: [
      { id: "fx1", currency: "USD", rate_date: "2026-10-26", rate: "3.2" },
      { id: "fx2", currency: "USD", rate_date: "2026-10-27", rate: "3.25" },
      { id: "fx3", currency: "CAD", rate_date: "2026-10-27", rate: "2.3" },
    ],
    expense_merchant_mappings: [{ id: "m1", merchant_key: "סופר", business_domain: "general_business", category: "food" }],
    ...overrides,
  };
}

describe("the accounts page from the device", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T09:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("every account's balance and register, with the ticks, the card line, the billing flags, the rates and the filing", async () => {
    const page = await computeLocalCard(createLocalSupabase(fakeReader(copy())), "bankPage", viewer);

    const bank = page.accounts.find((a) => a.id === "a1")!;
    const cash = page.accounts.find((a) => a.id === "a2")!;
    expect(bank.currentBalance).toBe(1200);
    expect(cash.currentBalance).toBe(150);
    expect(page.dataIncomplete).toBe(false);

    expect(bank.ledger.map((r) => [r.id, r.runningBalance, r.bankChecked])).toEqual([
      ["t:tr1:out", 1200, false],
      ["p:pay1", 1500, true],
    ]);
    const cardLine = cash.ledger.find((r) => r.id === "t:tr2:in")!;
    expect([cardLine.label, cardLine.sublabel]).toEqual(["מזומן מול כרטיס ויזה", "קניות"]);

    const expense = cash.ledger.find((r) => r.id === "e:e1")!;
    expect(expense.editRef).toMatchObject({ kind: "expense", data: { included_in_base_price: true, billed_to_customer: false } });

    expect(page.fxRates).toEqual({ USD: { rate: 3.25, date: "2026-10-27" }, CAD: { rate: 2.3, date: "2026-10-27" } });
    expect(page.merchantMemory["סופר"]).toEqual({ businessDomain: "general_business", projectId: "", propertyId: "", category: "food" });
    expect(page.projects).toEqual([{ id: "p1", name: "הובלה" }]);
  });

  it("not from a copy synced before the accounts tables (sync rules v1.14)", async () => {
    const before = copy({ business_settings: [{ id: "true", vat_rate: "0.18", money_tables: 1 }] });
    await expect(computeLocalCard(createLocalSupabase(fakeReader(before)), "bankPage", viewer)).rejects.toThrow(BANK_PAGE_NOT_READY);
  });

  it("a read the device can't do refuses the page rather than drawing a balance with a gap", async () => {
    const local = createLocalSupabase(fakeReader(copy(), { failOn: "account_transfers" }));
    await expect(computeLocalCard(local, "bankPage", viewer)).rejects.toThrow(/a read failed on the device/);
  });
});
