import { describe, it, expect, vi, beforeEach } from "vitest";

// loadProjectsPage reads the list in ONE query when project_dashboard_view
// carries the list columns (20261005150000_project_dashboard_view_list_columns),
// and falls back to the old two-step read (projects + project_financials_view +
// customers by id) while it doesn't. Both must give the browser the same rows.

vi.mock("@/lib/search/findMatchingCustomers", () => ({ findMatchingCustomers: vi.fn() }));
vi.mock("@/lib/search/findMatchingChildIds", () => ({ findProjectIdsMatchingContent: vi.fn() }));

const VIEW_ROW = {
  id: "p1",
  name: "פרויקט",
  status: "active",
  project_type: "moving",
  start_date: "2026-09-01",
  end_date: null,
  agreed_base_price: 1000,
  actual_price: null,
  customer_id: "c1",
  customer_name: "לקוח",
  project_manager_id: null,
  project_manager_name: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-02T00:00:00Z",
  total_expenses: 200,
  gross_profit: 800,
  total_tasks: 0,
  completed_tasks: 0,
  open_tasks: 0,
};
const SETTINGS = {
  id: "p1",
  expenses_billed_separately: false,
  payment_terms: "net_30",
  due_date: "2026-10-01T00:00:00",
  no_charge: false,
  branch_id: "b1",
};
const FINANCIALS = {
  id: "p1",
  total_expenses: 200,
  gross_profit: 800,
  customer_total_price: 1170,
  expenses_billed: 0,
  collected_amount: 500,
  pending_amount: 0,
  overdue_amount: 670,
  outstanding_amount: 670,
  next_due_date: null,
};
const PHONE = { id: "c1", phone: "0501234567" };

type Call = { table: string; select: string };

function fakeSupabase({ viewHasListColumns }: { viewHasListColumns: boolean }) {
  const calls: Call[] = [];
  const supabase = {
    from(table: string) {
      const call: Call = { table, select: "" };
      calls.push(call);
      const result = () => {
        if (table === "project_dashboard_view") {
          if (call.select.includes("customer_phone")) {
            if (!viewHasListColumns) return { data: null, error: { code: "42703", message: "no column" }, count: null };
            const { id: _s, ...settings } = SETTINGS;
            const { id: _f, ...financials } = FINANCIALS;
            return { data: [{ ...VIEW_ROW, ...settings, ...financials, customer_phone: PHONE.phone }], error: null, count: 1 };
          }
          return { data: [VIEW_ROW], error: null, count: 1 };
        }
        if (table === "projects") return { data: [SETTINGS], error: null };
        if (table === "project_financials_view") return { data: [FINANCIALS], error: null };
        if (table === "customers") return { data: [PHONE], error: null };
        return { data: [], error: null };
      };
      const builder: Record<string, unknown> = {};
      for (const method of ["eq", "not", "or", "order", "range", "in"]) builder[method] = () => builder;
      builder.select = (select: string) => {
        call.select = select;
        return builder;
      };
      builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject);
      return builder;
    },
  };
  return { supabase, calls };
}

const filters = { view: "projects" as const, status: "all", customerId: null, sort: "start_date_desc" as const, q: "" };

beforeEach(() => {
  vi.resetModules();
});

describe("loadProjectsPage", () => {
  it("reads the whole list in one query when the view has the list columns", async () => {
    const { loadProjectsPage } = await import("@/app/(app)/projects/loadProjects");
    const { supabase, calls } = fakeSupabase({ viewHasListColumns: true });
    const result = await loadProjectsPage(supabase as never, { page: 1, filters });
    expect(calls.map((c) => c.table)).toEqual(["project_dashboard_view"]);
    expect(result.rows).toHaveLength(1);
  });

  it("falls back to the two-step read while the view lacks them, without remembering it", async () => {
    const { loadProjectsPage } = await import("@/app/(app)/projects/loadProjects");
    const first = fakeSupabase({ viewHasListColumns: false });
    await loadProjectsPage(first.supabase as never, { page: 1, filters });
    expect(first.calls.map((c) => c.table)).toEqual([
      "project_dashboard_view",
      "project_dashboard_view",
      "projects",
      "project_financials_view",
      "customers",
    ]);
    // Once the migration lands, the same server goes straight to one query.
    const second = fakeSupabase({ viewHasListColumns: true });
    await loadProjectsPage(second.supabase as never, { page: 1, filters });
    expect(second.calls.map((c) => c.table)).toEqual(["project_dashboard_view"]);
  });

  it("gives the browser the same rows either way", async () => {
    const inlineModule = await import("@/app/(app)/projects/loadProjects");
    const inline = await inlineModule.loadProjectsPage(fakeSupabase({ viewHasListColumns: true }).supabase as never, {
      page: 1,
      filters,
    });
    vi.resetModules();
    const fallbackModule = await import("@/app/(app)/projects/loadProjects");
    const fallback = await fallbackModule.loadProjectsPage(
      fakeSupabase({ viewHasListColumns: false }).supabase as never,
      { page: 1, filters }
    );
    expect(inline.rows).toEqual(fallback.rows);
    expect(inline.rows[0]).toMatchObject({
      customer_phone: "0501234567",
      payment_terms: "net_30",
      due_date: "2026-10-01",
      branch_id: "b1",
      outstanding_amount: 670,
      overdue_amount: 670,
    });
    expect(inline.rows[0]).not.toHaveProperty("collected_amount");
  });
});
