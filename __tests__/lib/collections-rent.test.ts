import { describe, expect, it } from "vitest";
import { createLocalSupabase, type LocalReader } from "@/lib/powersync/local-supabase";
import { AppSchema } from "@/lib/powersync/schema";
import { buildRentSourceRows } from "@/lib/collections";

// Rent in the חייבים worklist (owner, 2026-10-25), by the rent page's own
// rule: one row per lease — its tenant — owed = every month past its due day
// that isn't in (a check we hold past its day and not deposited counts: "I
// want to show that it's debt, and I want to show that we have it"); the
// checks for months not due yet are expected, never owed. Each payment counts
// for the lease it was for — an earlier tenant's rent isn't the one renting
// now. Run on the device copy's reader, as the dashboard does.

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

const TODAY = "2026-10-21";

const lease = (row: Row): Row => ({
  property_id: "prop1",
  status: "active",
  end_date: null,
  rent_calendar: "gregorian",
  period_months: 1,
  rent_day_of_month: null,
  ...row,
});
const payment = (row: Row): Row => ({
  property_id: "prop1",
  business_domain: "property_management",
  payment_method: "bank_transfer",
  payment_status: "cleared",
  requires_split: 0,
  rent_periods: 1,
  counts_as_rent: 1,
  ...row,
});

function db(extra: { leases?: Row[]; payments?: Row[] } = {}) {
  return createLocalSupabase(
    reader({
      properties: [{ id: "prop1", name: "D4 הר יונה", address: "הגפן 3", is_active: 1 }],
      customers: [
        { id: "c1", name: "רוזנפלד", phone: "050" },
        { id: "c0", name: "שוכר קודם", phone: null },
      ],
      lease_agreements: extra.leases ?? [
        lease({ id: "l1", customer_id: "c1", start_date: "2026-08-01", monthly_rent_amount: "4000" }),
        lease({ id: "l0", customer_id: "c0", start_date: "2026-01-01", end_date: "2026-07-31", status: "ended", monthly_rent_amount: "3500" }),
      ],
      payments: extra.payments ?? [],
      accounts: [],
    })
  );
}

describe("rent in collections", () => {
  it("one row per tenant: owed = months past their day not in; a check not due yet is expected, not owed", async () => {
    const rows = await buildRentSourceRows(
      db({
        payments: [
          payment({ id: "aug", payment_date: "2026-08-01T00:00:00", amount_total: "4000", lease_id: "l1", rent_period_start: "2026-08-01" }),
          // November's check, dated ahead — expected.
          payment({ id: "nov", payment_date: "2026-08-01T00:00:00", due_date: "2026-11-01", amount_total: "4000", payment_method: "check", payment_status: "pending", lease_id: "l1", rent_period_start: "2026-11-01" }),
          // The earlier tenant paid all seven of their months: nothing of theirs here.
          ...["01", "02", "03", "04", "05", "06", "07"].map((m) =>
            payment({ id: `old${m}`, payment_date: `2026-${m}-01T00:00:00`, amount_total: "3500", lease_id: "l0", rent_period_start: `2026-${m}-01` })
          ),
        ],
      }),
      TODAY
    );
    expect(rows).toHaveLength(1);
    // September and October not in (₪8,000), oldest 1.9 — 50 days.
    expect(rows[0]).toMatchObject({
      source_type: "property",
      source_id: "prop1",
      collection_key: "property:prop1:l1",
      customer_id: "c1",
      customer_name: "רוזנפלד",
      title: "D4 הר יונה",
      overdue_amount: 8000,
      outstanding_amount: 8000,
      pending_amount: 4000,
      next_due_date: "2026-11-01",
      due_date: "2026-09-01",
      days_late: 50,
      collection_status: "overdue",
    });
  });

  it("a check we hold past its day, not deposited: owed", async () => {
    const rows = await buildRentSourceRows(
      db({
        payments: [
          payment({ id: "aug", payment_date: "2026-08-01T00:00:00", amount_total: "4000", lease_id: "l1", rent_period_start: "2026-08-01" }),
          payment({ id: "sep", payment_date: "2026-09-01T00:00:00", amount_total: "4000", lease_id: "l1", rent_period_start: "2026-09-01" }),
          payment({ id: "oct", payment_date: "2026-08-01T00:00:00", due_date: "2026-10-01", amount_total: "4000", payment_method: "check", payment_status: "pending", lease_id: "l1", rent_period_start: "2026-10-01" }),
        ],
        leases: [lease({ id: "l1", customer_id: "c1", start_date: "2026-08-01", monthly_rent_amount: "4000" })],
      }),
      TODAY
    );
    expect(rows[0]).toMatchObject({ overdue_amount: 4000, outstanding_amount: 4000, pending_amount: 0, days_late: 20 });
  });

  it("a lease that ended still owing stays; one fully paid, nothing owed and no checks to come, isn't listed", async () => {
    const rows = await buildRentSourceRows(
      db({
        leases: [
          lease({ id: "l0", customer_id: "c0", start_date: "2026-06-01", end_date: "2026-07-31", status: "ended", monthly_rent_amount: "3500" }),
          lease({ id: "l1", customer_id: "c1", start_date: "2026-10-01", monthly_rent_amount: "4000" }),
        ],
        payments: [
          payment({ id: "jun", payment_date: "2026-06-01T00:00:00", amount_total: "3500", lease_id: "l0", rent_period_start: "2026-06-01" }),
          payment({ id: "oct", payment_date: "2026-10-01T00:00:00", amount_total: "4000", lease_id: "l1", rent_period_start: "2026-10-01" }),
        ],
      }),
      TODAY
    );
    expect(rows.map((r) => [r.customer_id, r.overdue_amount])).toEqual([["c0", 3500]]);
  });
});
