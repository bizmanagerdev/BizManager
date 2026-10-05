import { describe, it, expect, vi } from "vitest";
import { attachOwedToRows, combineProjectOwed, emptyProjectOwed, loadProjectOwed, withWorkerBalance } from "@/lib/projects/owed";

// "אנחנו חייבים" on a project = its expenses not fully paid (what's left of
// each) + the wages still owed for it.

describe("combineProjectOwed", () => {
  it("adds what's left of each unpaid expense to the wages still owed", () => {
    const owed = combineProjectOwed(
      [
        {
          project_id: "p1",
          expenses: { id: "e1", amount: 33431, paid_amount: 10000, payment_status: "partial", expense_date: "2026-09-14", category: "חשבונית מכולה", description: "" },
        },
        {
          project_id: "p1",
          // PostgREST may hand the embedded row back as a one-element array.
          expenses: [{ id: "e2", amount: "1200", paid_amount: null, payment_status: "not_paid", expense_date: "2026-08-01", category: "הובלה", description: "משאית" }],
        },
      ],
      [{ project_id: "p1", owed_amount: 4000, paid_amount: 6000 }]
    ).get("p1");
    expect(owed).toMatchObject({ expensesOpen: 24631, workersOwed: 4000, workersPaid: 6000, total: 28631 });
    // Oldest first, labelled by description, else category.
    expect(owed?.expenses.map((e) => [e.label, e.open, e.status])).toEqual([
      ["משאית", 1200, "not_paid"],
      ["חשבונית מכולה", 23431, "partial"],
    ]);
    expect(owed?.expenses[1]).toMatchObject({ total: 33431, paid: 10000 });
  });

  it("paid expenses and an overpaid wage balance add nothing", () => {
    const owed = combineProjectOwed(
      [{ project_id: "p2", expenses: { id: "e3", amount: 500, paid_amount: 500, payment_status: "paid" } }],
      [{ project_id: "p2", owed_amount: -300, paid_amount: 800 }]
    ).get("p2");
    expect(owed?.total).toBe(0);
    expect(owed?.expenses).toEqual([]);
  });

  it("keeps projects apart", () => {
    const map = combineProjectOwed(
      [
        { project_id: "a", expenses: { id: "x", amount: 100, payment_status: "not_paid" } },
        { project_id: "b", expenses: { id: "y", amount: 200, payment_status: "not_paid" } },
      ],
      []
    );
    expect(map.get("a")?.total).toBe(100);
    expect(map.get("b")?.total).toBe(200);
  });
});

describe("withWorkerBalance", () => {
  it("fills in the wages from the page's own worker balance", () => {
    const base = combineProjectOwed([{ project_id: "p", expenses: { id: "e", amount: 1000, payment_status: "not_paid" } }], []).get("p")!;
    expect(withWorkerBalance(base, 2500, 500)).toMatchObject({ expensesOpen: 1000, workersOwed: 2500, workersPaid: 500, total: 3500 });
    expect(withWorkerBalance(emptyProjectOwed(), -100, 0).total).toBe(0);
  });
});

describe("loadProjectOwed", () => {
  function fakeSupabase(failLinks = false) {
    const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
    const supabase = {
      from(table: string) {
        const call = { table, filters: [] as Array<[string, unknown]> };
        calls.push(call);
        const builder: Record<string, unknown> = {
          select: () => builder,
          in: (column: string, values: unknown) => {
            call.filters.push([column, values]);
            return builder;
          },
          then: (resolve: (v: unknown) => void) => {
            if (table === "project_expenses") {
              resolve(
                failLinks
                  ? { data: null, error: { message: "boom" } }
                  : { data: [{ project_id: "p1", expenses: { id: "e", amount: 300, payment_status: "not_paid" } }], error: null }
              );
            } else {
              resolve({ data: [{ project_id: "p1", owed_amount: 50, paid_amount: 0 }], error: null });
            }
          },
        };
        return builder;
      },
    };
    return { supabase: supabase as never, calls };
  }

  it("reads only the unpaid expenses of the given projects, with their wages", async () => {
    const { supabase, calls } = fakeSupabase();
    const owed = await loadProjectOwed(supabase, ["p1", "p1"]);
    expect(owed.get("p1")?.total).toBe(350);
    expect(calls.map((c) => c.table)).toEqual(["project_expenses", "project_worker_balance_view"]);
    expect(calls[0].filters).toEqual([
      ["project_id", ["p1"]],
      ["expenses.payment_status", ["not_paid", "partial"]],
    ]);
  });

  it("skips the wages read when the caller already has it, and a failed read owes nothing", async () => {
    const { supabase, calls } = fakeSupabase(true);
    const owed = await loadProjectOwed(supabase, ["p1"], { includeWorkers: false });
    expect(calls.map((c) => c.table)).toEqual(["project_expenses"]);
    expect(owed.get("p1")).toBeUndefined();
  });

  it("no projects, no reads", async () => {
    const from = vi.fn();
    expect((await loadProjectOwed({ from } as never, [])).size).toBe(0);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("loadProjectOwed(null) — every project that owes, for the list", () => {
  it("reads only open rows, no project filter, and pages them", async () => {
    const calls: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];
    const supabase = {
      from(table: string) {
        const call = { table, filters: [] as Array<[string, string, unknown]> };
        calls.push(call);
        const builder: Record<string, unknown> = {
          select: () => builder,
          order: () => builder,
          in: (column: string, values: unknown) => (call.filters.push(["in", column, values]), builder),
          gt: (column: string, value: unknown) => (call.filters.push(["gt", column, value]), builder),
          range: () =>
            Promise.resolve(
              table === "project_expenses"
                ? { data: [{ project_id: "p9", expenses: { id: "e", amount: 700, payment_status: "not_paid" } }], error: null }
                : { data: [{ project_id: "p9", owed_amount: 300, paid_amount: 0 }], error: null }
            ),
        };
        return builder;
      },
    };
    const owed = await loadProjectOwed(supabase as never, null);
    expect(owed.get("p9")?.total).toBe(1000);
    expect(calls[0].filters).toEqual([["in", "expenses.payment_status", ["not_paid", "partial"]]]);
    expect(calls[1].filters).toEqual([["gt", "owed_amount", 0.009]]);
  });
});

describe("attachOwedToRows", () => {
  it("adds the row fields, 0 for projects that owe nothing", () => {
    const owed = combineProjectOwed([{ project_id: "a", expenses: { id: "x", amount: 100, payment_status: "not_paid" } }], [
      { project_id: "a", owed_amount: 50, paid_amount: 0 },
    ]);
    expect(attachOwedToRows([{ id: "a", name: "A" }, { id: "b" }], owed)).toEqual([
      { id: "a", name: "A", we_owe_amount: 150, we_owe_expenses: 100, we_owe_workers: 50 },
      { id: "b", we_owe_amount: 0, we_owe_expenses: 0, we_owe_workers: 0 },
    ]);
  });
});
