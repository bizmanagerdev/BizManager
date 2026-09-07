import { describe, it, expect } from "vitest";
import { SYSTEM_RULES } from "@/lib/reminders/system-rules";

// SYSTEM_RULES drives the inbox/dashboard/push worklist — each rule's
// evaluate() returns the "problems that currently exist", one url per item.
// Several of these urls used to drop an id the rule already had (customer,
// worker, expense) and land on a bare list instead — these tests exercise the
// evaluate() functions directly (bypassing the DB-upsert half of the engine,
// syncSystemReminders) against a fake Supabase client, and lock in the fix.

function rule(key: string) {
  const found = SYSTEM_RULES.find((r) => r.key === key);
  if (!found) throw new Error(`no system rule registered with key "${key}"`);
  return found;
}

function ctx(todayIso = "2026-09-07") {
  return {
    todayIso,
    nowIso: `${todayIso}T12:00:00.000Z`,
    today: new Date(`${todayIso}T00:00:00.000Z`),
    nearHorizonIso: todayIso,
  };
}

type TableResponse = { data?: unknown[] | null; error?: { message: string } | null };

// A minimal chainable query-builder stand-in: every filter method (.eq/.not/
// .lt/.lte/.gt/.in/.order/...) just returns itself, and the chain resolves
// to the canned response for that table when awaited — same shape the rest
// of this app's route tests already use (see __tests__/api/expenses-create).
function makeSupabase(responses: Record<string, TableResponse>) {
  const from = (table: string) => {
    const resp: TableResponse = responses[table] ?? { data: [], error: null };
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "lt", "lte", "gt", "gte", "in", "order", "range", "limit"]) {
      builder[m] = () => builder;
    }
    builder.then = (onF: (v: TableResponse) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(resp).then(onF, onR);
    return builder;
  };
  return { from } as unknown as Parameters<(typeof SYSTEM_RULES)[number]["evaluate"]>[0];
}

describe("check_deposit_due", () => {
  it("focuses the specific check on the checks register (was a bare /checks link)", async () => {
    const supabase = makeSupabase({
      payments: {
        data: [
          {
            id: "pay-1",
            check_number: "1042",
            amount_total: 1500,
            due_date: "2026-09-01",
            payment_status: "pending",
            order_id: "order-1",
            project_id: null,
          },
        ],
      },
    });
    const items = await rule("check_deposit_due").evaluate(supabase, ctx());
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("/checks?focus=pay-1");
    expect(items[0].links).toEqual({ payment_id: "pay-1", order_id: "order-1", project_id: null });
  });
});

describe("promise_broken", () => {
  it("focuses the specific customer on the collections page (was a bare /collections?view=debtors link)", async () => {
    const supabase = makeSupabase({
      payment_promises: {
        data: [
          {
            id: "promise-1",
            customer_id: "cust-1",
            amount: 800,
            promised_date: "2026-09-01",
            order_id: "order-2",
            project_id: null,
          },
        ],
      },
      customers: { data: [{ id: "cust-1", name: "ביאן מרקט" }] },
    });
    const items = await rule("promise_broken").evaluate(supabase, ctx());
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("/collections?focus=cust-1");
    expect(items[0].title).toContain("ביאן מרקט");
  });

  it("falls back to the bare list only when there's genuinely no customer id", async () => {
    const supabase = makeSupabase({
      payment_promises: {
        data: [{ id: "promise-2", customer_id: null, amount: 200, promised_date: "2026-09-01" }],
      },
      customers: { data: [] },
    });
    const items = await rule("promise_broken").evaluate(supabase, ctx());
    expect(items[0].url).toBe("/collections");
  });
});

describe("wage_overdue", () => {
  it("links to the specific worker's profile (was a bare /payroll link)", async () => {
    const supabase = makeSupabase({
      worker_debt_items_view: {
        data: [
          {
            user_id: "user-1",
            source_date: "2026-07-01",
            due_date: "2026-08-10",
            owed_amount: 3000,
            source_type: "payslip",
          },
        ],
      },
      users: { data: [{ id: "user-1", full_name: "יעקב הלר" }] },
    });
    const items = await rule("wage_overdue").evaluate(supabase, ctx());
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("/payroll/workers/user-1");
    expect(items[0].title).toContain("יעקב הלר");
  });
});

describe("recurring_expense_confirm", () => {
  it("opens the expense's own edit dialog on /financial (was a bare /financial link)", async () => {
    const supabase = makeSupabase({
      expenses: {
        data: [
          {
            id: "exp-1",
            expense_date: "2026-09-01",
            payment_status: "not_paid",
            recurring_expense_template_id: "tpl-1",
          },
        ],
      },
    });
    const items = await rule("recurring_expense_confirm").evaluate(supabase, ctx());
    expect(items).toHaveLength(1);
    expect(items[0].url).toBe(`/financial?focus=${encodeURIComponent("expense:exp-1")}`);
  });
});
