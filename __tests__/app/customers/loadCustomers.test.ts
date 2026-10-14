import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CUSTOMERS_PAGE_SIZE,
  loadCustomerIdsPassingFilters,
  loadCustomersByIds,
  loadCustomersPage,
} from "@/app/(app)/customers/loadCustomers";
import { NO_CUSTOMERS_FILTERS } from "@/app/(app)/customers/customersFilters";

// How the customers list reads its rows (the playbook's server-speed steps):
// - customer_name, then id — customers who share a name keep one order, so
//   paging never repeats or skips one;
// - every `.in()` list in batches of at most 150 ids;
// - reads that can pass 1000 rows are paged, so a big customer's totals are
//   whole;
// - the enrichment reads go out together, and the project money waits only
//   for the projects;
// - nothing read that only a removed details dialog used (Morning documents,
//   contacts, last order / payment dates).

type Row = Record<string, unknown>;
type Call = {
  table: string;
  select?: string;
  inColumn?: string;
  inValues?: string[];
  orders: string[];
  filters: Array<[string, string, unknown]>;
  range?: [number, number];
};
type Answer = { data: Row[] | null; error: unknown; count?: number | null };

function fakeSupabase(answer: (call: Call) => Answer | Promise<Answer>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, orders: [], filters: [] };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    builder.select = (select: string) => {
      call.select = select;
      return builder;
    };
    builder.in = (column: string, values: string[]) => {
      call.inColumn = column;
      call.inValues = values;
      return builder;
    };
    builder.order = (column: string) => {
      call.orders.push(column);
      return builder;
    };
    for (const op of ["gt", "lte", "eq"]) {
      builder[op] = (column: string, value: unknown) => {
        call.filters.push([op, column, value]);
        return builder;
      };
    }
    builder.range = (lo: number, hi: number) => {
      call.range = [lo, hi];
      return builder;
    };
    builder.then = (onF: (v: Answer) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(answer(call)).then(onF, onR);
    return builder;
  };
  return { supabase: { from } as unknown as SupabaseClient, calls };
}

const overviewRow = (id: string, name = `לקוח ${id}`): Row => ({
  customer_id: id,
  customer_name: name,
  orders_count: 0,
  projects_count: 0,
  active: true,
});

/** Rows of a paged read for this call's range. */
function page(rows: Row[], call: Call): Answer {
  const [lo, hi] = call.range ?? [0, rows.length - 1];
  return { data: rows.slice(lo, hi + 1), error: null };
}

describe("loadCustomersPage", () => {
  it("sorts by name, then id, and reads page 2 from row 50", async () => {
    const { supabase, calls } = fakeSupabase((call) =>
      call.table === "customer_overview_view" ? { data: [overviewRow("c1")], error: null, count: 51 } : { data: [], error: null }
    );
    const result = await loadCustomersPage(supabase, { page: 2, filters: NO_CUSTOMERS_FILTERS });
    const overview = calls.find((c) => c.table === "customer_overview_view")!;
    expect(overview.orders).toEqual(["customer_name", "customer_id"]);
    expect(overview.range).toEqual([CUSTOMERS_PAGE_SIZE, 2 * CUSTOMERS_PAGE_SIZE - 1]);
    expect(result).toMatchObject({ totalCount: 51, hasMore: false, error: null });
  });

  it("applies the four filters to the view", async () => {
    const { supabase, calls } = fakeSupabase(() => ({ data: [], error: null, count: 0 }));
    await loadCustomersPage(supabase, {
      page: 1,
      filters: { withProjects: "yes", withOrders: "no", withDebt: "yes", activeOnly: "no" },
    });
    expect(calls.find((c) => c.table === "customer_overview_view")!.filters).toEqual([
      ["gt", "projects_count", 0],
      ["lte", "orders_count", 0],
      ["gt", "open_balance", 0],
      ["eq", "active", false],
    ]);
  });

  it("doesn't read what only the removed details dialog used", async () => {
    const { supabase, calls } = fakeSupabase((call) =>
      call.table === "customer_overview_view" ? { data: [overviewRow("c1")], error: null, count: 1 } : { data: [], error: null }
    );
    await loadCustomersPage(supabase, { page: 1, filters: NO_CUSTOMERS_FILTERS });
    const tables = calls.map((c) => c.table);
    expect(tables).not.toContain("morning_documents");
    expect(tables).not.toContain("contacts");
    const overview = calls.find((c) => c.table === "customer_overview_view")!;
    for (const column of ["total_sales", "total_paid", "last_order_at", "last_payment_at"]) {
      expect(overview.select).not.toContain(column);
    }
    const customers = calls.find((c) => c.table === "customers")!;
    expect(customers.select).toContain("morning_client_id");
    expect(customers.select).not.toMatch(/morning_synced_at|morning_match_status|morning_last_sync_error/);
  });

  it("says a failed read in Hebrew, never the database's own words", async () => {
    const { supabase } = fakeSupabase(() => ({ data: null, error: { message: "permission denied for view customer_overview_view" } }));
    const result = await loadCustomersPage(supabase, { page: 1, filters: NO_CUSTOMERS_FILTERS });
    expect(result.error).toMatch(/[א-ת]/);
    expect(result.error).not.toContain("permission denied");
  });

  it("works out the debt as before: orders plus projects, less what was collected", async () => {
    const { supabase } = fakeSupabase((call) => {
      switch (call.table) {
        case "customer_overview_view":
          return { data: [overviewRow("c1")], error: null, count: 1 };
        case "customers":
          return { data: [{ id: "c1", whatsapp: "050", morning_client_id: "m1", requires_prepayment: true, linked_user_id: null }], error: null };
        case "order_overview_view":
          return page(
            [
              { order_id: "o1", customer_id: "c1", total_amount: 1000, collected_amount: 400, pending_amount: 100 },
              { order_id: "o2", customer_id: "c1", total_amount: 500, collected_amount: 500, pending_amount: 0 },
            ],
            call
          );
        case "projects":
          return page([{ id: "p1", customer_id: "c1", agreed_base_price: 2000, actual_price: 0, price_includes_vat: false, vat_rate: null }], call);
        case "project_financials_view":
          return page([{ id: "p1", customer_total_price: 2000, expenses_billed: 0 }], call);
        case "payments":
          return page([{ project_id: "p1", amount_total: 1500, net_amount: null, payment_status: "paid", due_date: null }], call);
        default:
          return { data: [], error: null };
      }
    });
    const { rows } = await loadCustomersPage(supabase, { page: 1, filters: NO_CUSTOMERS_FILTERS });
    expect(rows[0]).toMatchObject({
      total_sales: 3500,
      total_paid: 2400,
      open_balance: 1100,
      morning_client_id: "m1",
      requires_prepayment: true,
      whatsapp: "050",
    });
    expect(rows[0]).not.toHaveProperty("contacts");
    expect(rows[0]).not.toHaveProperty("morning_documents");
  });
});

describe("the enrichment reads", () => {
  it("go out together; the project money waits for the projects alone, not the orders", async () => {
    const started: string[] = [];
    let releaseOrders: (() => void) | null = null;
    const { supabase } = fakeSupabase((call) => {
      started.push(call.table);
      if (call.table === "customer_overview_view") return { data: [overviewRow("c1")], error: null, count: 1 };
      if (call.table === "order_overview_view") {
        return new Promise<Answer>((resolve) => {
          releaseOrders = () => resolve({ data: [], error: null });
        });
      }
      if (call.table === "projects") return page([{ id: "p1", customer_id: "c1" }], call);
      return { data: [], error: null };
    });
    const loading = loadCustomersPage(supabase, { page: 1, filters: NO_CUSTOMERS_FILTERS });
    // The orders read hasn't answered, yet the project money is already asked for.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toEqual(
      expect.arrayContaining(["customers", "order_overview_view", "projects", "project_financials_view", "payments"])
    );
    releaseOrders!();
    await loading;
  });

  it("batch every id list to 150 at most", async () => {
    const ids = Array.from({ length: 400 }, (_, i) => `c${i}`);
    const projects = ids.map((id) => ({ id: `p-${id}`, customer_id: id }));
    const { supabase, calls } = fakeSupabase((call) => {
      if (call.table === "customer_overview_view") {
        return page(
          (call.inValues ?? []).map((id) => overviewRow(id)),
          call
        );
      }
      if (call.table === "projects") return page(projects.filter((p) => call.inValues?.includes(p.customer_id)), call);
      return { data: [], error: null };
    });
    const { rows } = await loadCustomersByIds(supabase, ids);
    expect(rows).toHaveLength(400);
    const inCalls = calls.filter((c) => c.inValues);
    for (const table of ["customer_overview_view", "customers", "order_overview_view", "projects", "project_financials_view", "payments"]) {
      const ofTable = inCalls.filter((c) => c.table === table);
      expect(ofTable.length).toBeGreaterThan(1);
      expect(Math.max(...ofTable.map((c) => c.inValues!.length))).toBeLessThanOrEqual(150);
    }
  });

  it("page past 1000 rows, so a big customer's orders all count", async () => {
    const orders = Array.from({ length: 1500 }, (_, i) => ({
      order_id: `o${String(i).padStart(4, "0")}`,
      customer_id: "big",
      total_amount: 10,
      collected_amount: 0,
      pending_amount: 0,
    }));
    const { supabase, calls } = fakeSupabase((call) => {
      if (call.table === "customer_overview_view") return { data: [overviewRow("big")], error: null, count: 1 };
      if (call.table === "order_overview_view") return page(orders, call);
      return { data: [], error: null };
    });
    const { rows } = await loadCustomersPage(supabase, { page: 1, filters: NO_CUSTOMERS_FILTERS });
    expect(rows[0]).toMatchObject({ total_sales: 15000, open_balance: 15000 });
    const orderReads = calls.filter((c) => c.table === "order_overview_view");
    expect(orderReads.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    // A unique order under the paging, so no row is read twice or skipped.
    expect(orderReads[0].orders).toEqual(["order_id"]);
  });
});

describe("loadCustomersByIds", () => {
  it("applies the list's filters when given, ordered by name then id", async () => {
    const { supabase, calls } = fakeSupabase(() => ({ data: [], error: null }));
    await loadCustomersByIds(supabase, ["c1", "c2"], { ...NO_CUSTOMERS_FILTERS, withDebt: "yes" });
    const overview = calls.find((c) => c.table === "customer_overview_view")!;
    expect(overview.filters).toEqual([["gt", "open_balance", 0]]);
    expect(overview.orders).toEqual(["customer_name", "customer_id"]);
  });

  it("reads nothing for no ids", async () => {
    const { supabase, calls } = fakeSupabase(() => ({ data: [], error: null }));
    expect(await loadCustomersByIds(supabase, ["", "  "])).toEqual({ rows: [], error: null });
    expect(calls).toHaveLength(0);
  });
});

describe("loadCustomerIdsPassingFilters", () => {
  it("keeps the search's own order (best match first) and reads only the ids", async () => {
    const { supabase, calls } = fakeSupabase((call) =>
      page(
        (call.inValues ?? []).filter((id) => id !== "b").map((id) => ({ customer_id: id })),
        call
      )
    );
    const result = await loadCustomerIdsPassingFilters(supabase, ["c", "b", "a"], { ...NO_CUSTOMERS_FILTERS, withOrders: "yes" });
    expect(result).toEqual({ ids: ["c", "a"], error: null });
    expect(calls[0].select).toBe("customer_id");
    expect(calls[0].filters).toEqual([["gt", "orders_count", 0]]);
  });

  it("answers a failure in Hebrew, with no ids", async () => {
    const { supabase } = fakeSupabase(() => ({ data: null, error: { message: "timeout" } }));
    const result = await loadCustomerIdsPassingFilters(supabase, ["a"], NO_CUSTOMERS_FILTERS);
    expect(result.ids).toEqual([]);
    expect(result.error).toMatch(/[א-ת]/);
  });
});
