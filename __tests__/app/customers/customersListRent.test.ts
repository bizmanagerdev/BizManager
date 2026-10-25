import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalSupabase, type LocalReader } from "@/lib/powersync/local-supabase";
import { AppSchema } from "@/lib/powersync/schema";
import { computeLocalListPage } from "@/lib/powersync/dashboard-local";

// The customers list's "חוב שכירות" note (owner, 2026-10-25): a tenant's rent
// still owed, by the rent page's own rule — beside the list's debt, which stays
// orders and projects. Run on the device copy's reader, as the list is.

type Row = Record<string, unknown>;
const COLUMNS = new Map(AppSchema.tables.map((table) => [table.name, table.columns.map((column) => column.name)]));
const padded = (table: string, row: Row): Row => ({
  ...Object.fromEntries((COLUMNS.get(table) ?? []).map((column) => [column, null])),
  ...row,
});

function reader(tables: Record<string, Row[]>): LocalReader {
  return {
    async getAll<T>(sql: string): Promise<T[]> {
      const match = /^SELECT \* FROM ([a-z_]+)/.exec(sql);
      if (!match) throw new Error(`can't run: ${sql}`);
      return (tables[match[1]] ?? []).map((row) => padded(match[1], row)) as T[];
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("the customers list's rent note", () => {
  it("a tenant's rent owed beside the list's debt — by the rent page's rule", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T10:00:00.000Z"));
    const db = createLocalSupabase(
      reader({
        customers: [
          { id: "c1", name: "רוזנפלד", active: 1, requires_prepayment: 0 },
          { id: "c2", name: "לקוח רגיל", active: 1, requires_prepayment: 0 },
        ],
        properties: [{ id: "prop1", name: "D4", address: "הגפן 3", is_active: 1 }],
        lease_agreements: [
          {
            id: "l1", property_id: "prop1", customer_id: "c1", status: "active", start_date: "2026-08-01", end_date: null,
            monthly_rent_amount: "4000", rent_calendar: "gregorian", period_months: 1,
          },
        ],
        payments: [
          {
            id: "aug", property_id: "prop1", business_domain: "property_management", payment_date: "2026-08-01T00:00:00",
            amount_total: "4000", payment_method: "bank_transfer", payment_status: "cleared", requires_split: 0,
            lease_id: "l1", rent_period_start: "2026-08-01", rent_periods: 1, counts_as_rent: 1,
          },
        ],
      })
    );
    const all = { withProjects: "all", withOrders: "all", withDebt: "all", activeOnly: "all" } as const;
    const page = await computeLocalListPage(db, "customersList", all, 1);
    const byId = new Map((page.rows as Row[]).map((row) => [row.customer_id, row]));
    // September and October not in.
    expect(byId.get("c1")).toMatchObject({ rent_owed: 8000, open_balance: 0 });
    expect(byId.get("c2")).toMatchObject({ rent_owed: 0 });

    // "With debt" finds the tenant who owes only rent (owner, 2026-10-25: "fix this"); "without" leaves them out.
    const withDebt = await computeLocalListPage(db, "customersList", { ...all, withDebt: "yes" }, 1);
    expect((withDebt.rows as Row[]).map((row) => row.customer_id)).toEqual(["c1"]);
    const withoutDebt = await computeLocalListPage(db, "customersList", { ...all, withDebt: "no" }, 1);
    expect((withoutDebt.rows as Row[]).map((row) => row.customer_id)).toEqual(["c2"]);
  });
});
