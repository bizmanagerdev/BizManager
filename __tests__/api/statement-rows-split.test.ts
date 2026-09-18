import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// POST /api/expenses/statement-rows/split — one card-statement line divided
// across business domains. The line keeps the first part; each other part is
// a new line after it, and, when the line was already an expense, its own
// expense too.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ logAuditEvent: vi.fn(async () => {}) }));

import { POST } from "@/app/api/expenses/statement-rows/split/route";

const row = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  statement_id: "s1",
  expense_id: null,
  include: true,
  expense_date: "2026-09-02",
  transaction_date: "2026-08-20",
  amount: 1000,
  description: "אושר עד",
  category: "ויזה",
  notes: null,
  card_label: "ויזה",
  assignment_raw: null,
  row_index: 7,
  ...over,
});

const parts = [
  { business_domain: "home", amount: 500 },
  { business_domain: "sales", amount: 340 },
  { business_domain: "general_business", amount: 160 },
];

function post(body: unknown) {
  return POST(new Request("http://test/api/expenses/statement-rows/split", { method: "POST", body: JSON.stringify(body) }));
}

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}

beforeEach(() => requireRouteAccess.mockReset());

describe("POST /api/expenses/statement-rows/split", () => {
  it("a line not yet an expense: the line keeps the first part, the others become lines after it", async () => {
    const supabase = makeSupabase({
      card_statement_rows: { read: { data: row(), error: null }, write: { data: [{ id: "r2" }, { id: "r3" }], error: null } },
    });
    grant(supabase);
    const res = await post({ row_id: "r1", parts });
    expect(res.status).toBe(200);

    const [inserted] = supabase.calls.insert.card_statement_rows as Array<Array<Record<string, unknown>>>;
    expect(inserted.map((r) => [r.business_domain, r.amount, r.expense_id])).toEqual([
      ["sales", 340, null],
      ["general_business", 160, null],
    ]);
    // Same card, merchant, dates and position as the original.
    expect(inserted[0]).toMatchObject({ statement_id: "s1", description: "אושר עד", card_label: "ויזה", row_index: 7, expense_date: "2026-09-02" });
    const [updated] = supabase.calls.update.card_statement_rows as Array<Record<string, unknown>>;
    expect(updated).toMatchObject({ amount: 500, business_domain: "home" });
    // Nothing is created as an expense yet — "צור הוצאות" does that.
    expect(supabase.calls.insert.expenses).toBeUndefined();
  });

  it("a line that is already an expense: that expense takes the first part, each other part gets its own", async () => {
    const supabase = makeSupabase({
      card_statement_rows: {
        read: { data: row({ expense_id: "e1" }), error: null },
        write: { data: [{ id: "r2", expense_id: "e2" }, { id: "r3", expense_id: "e3" }], error: null },
      },
      expenses: { read: { data: { id: "e1" }, error: null }, write: { data: [{ id: "e2" }, { id: "e3" }], error: null } },
    });
    grant(supabase);
    const res = await post({ row_id: "r1", parts });
    expect(res.status).toBe(200);

    const [newExpenses] = supabase.calls.insert.expenses as Array<Array<Record<string, unknown>>>;
    expect(newExpenses.map((e) => [e.business_domain, e.amount])).toEqual([
      ["sales", 340],
      ["general_business", 160],
    ]);
    expect(newExpenses[0]).toMatchObject({ payment_method: "credit_card", payment_status: "paid", category: "ויזה", expense_date: "2026-09-02" });
    const [firstExpense] = supabase.calls.update.expenses as Array<Record<string, unknown>>;
    expect(firstExpense).toMatchObject({ amount: 500, business_domain: "home" });
    const [newRows] = supabase.calls.insert.card_statement_rows as Array<Array<Record<string, unknown>>>;
    expect(newRows.map((r) => r.expense_id)).toEqual(["e2", "e3"]);
  });

  it("refuses parts that don't add up to the line", async () => {
    const supabase = makeSupabase({ card_statement_rows: { data: row(), error: null } });
    grant(supabase);
    const res = await post({ row_id: "r1", parts: [{ business_domain: "home", amount: 500 }, { business_domain: "sales", amount: 400 }] });
    expect(res.status).toBe(400);
    expect(supabase.calls.insert.card_statement_rows).toBeUndefined();
  });
});
