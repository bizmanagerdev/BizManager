import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// POST /api/expenses/statement-rows/create-expenses — a statement's ticked, assigned lines:
// purchases become expenses, refunds become income in their domain (owner, 2026-10-13).
// The refund income must never reach a bank account, a customer or Grow's card deposits.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ logAuditEvent: vi.fn(async () => {}) }));

import { POST } from "@/app/api/expenses/statement-rows/create-expenses/route";

const line = (over: Record<string, unknown>) => ({
  id: "r",
  expense_id: null,
  include: true,
  expense_date: "2026-10-02",
  transaction_date: "2026-09-10",
  amount: 100,
  description: "חנות",
  category: "ויזה כאל זהב 9828",
  business_domain: "home",
  project_id: null,
  property_id: null,
  notes: null,
  card_label: "ויזה כאל זהב 9828",
  income_payment_id: null,
  ...over,
});

function post() {
  return POST(
    new Request("http://test/api/expenses/statement-rows/create-expenses", {
      method: "POST",
      body: JSON.stringify({ statement_id: "s1" }),
    })
  );
}

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}

beforeEach(() => requireRouteAccess.mockReset());

describe("POST /api/expenses/statement-rows/create-expenses", () => {
  it("records a refund as income in its domain — no account, no customer, method card_refund", async () => {
    const supabase = makeSupabase({
      card_statement_rows: {
        data: [
          line({ id: "r1", amount: 412.3, description: "שופרסל" }),
          line({ id: "r2", amount: -1257.66, description: "TEMU" }),
          line({ id: "r3", amount: 740, business_domain: "logistics_projects", project_id: "proj-1", description: "חומרי בניין" }),
        ],
        error: null,
      },
      payments: { read: { data: null, error: null }, write: { data: [{ id: "p1" }], error: null } },
      expenses: { read: { data: null, error: null }, write: { data: [{ id: "e1" }, { id: "e3" }], error: null } },
    });
    grant(supabase);

    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 2, refunds: 1 });

    const [refunds] = supabase.calls.insert.payments as Array<Array<Record<string, unknown>>>;
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      amount_total: 1257.66,
      net_amount: 1257.66,
      vat_amount: 0,
      payment_method: "card_refund",
      payment_status: "cleared",
      account_id: null,
      business_domain: "home",
      payment_date: "2026-10-02",
      project_id: null,
      order_id: null,
      property_id: null,
      recorded_by: "auth-1",
    });
    expect(refunds[0].notes).toBe("זיכוי בכרטיס ויזה כאל זהב 9828: TEMU");
    // The refund line points at its income.
    expect(supabase.calls.update.card_statement_rows).toContainEqual({ income_payment_id: "p1" });

    // Purchases only become expenses — never the refund.
    const [expenses] = supabase.calls.insert.expenses as Array<Array<Record<string, unknown>>>;
    expect(expenses.map((e) => [e.amount, e.payment_method])).toEqual([
      [412.3, "credit_card"],
      [740, "credit_card"],
    ]);
  });

  it("bills a project line to the project's customer when the line says so", async () => {
    const supabase = makeSupabase({
      // The fake answers every read of the table the same way, so the "billed lines" read
      // returns this line too — i.e. it is marked "לחיוב לקוח".
      card_statement_rows: {
        data: [line({ id: "r3", amount: 740, business_domain: "logistics_projects", project_id: "proj-1" })],
        error: null,
      },
      expenses: { read: { data: null, error: null }, write: { data: [{ id: "e3" }], error: null } },
    });
    grant(supabase);

    const res = await post();
    expect(res.status).toBe(200);
    const [links] = supabase.calls.insert.project_expenses as Array<Array<Record<string, unknown>>>;
    expect(links).toEqual([
      { project_id: "proj-1", expense_id: "e3", included_in_base_price: false, billed_to_customer: true, notes: null },
    ]);
  });

  it("a property's line needs a property's category — the card's name isn't one (owner, 2026-10-22)", async () => {
    const supabase = makeSupabase({
      card_statement_rows: {
        data: [
          line({ id: "r1", business_domain: "property_management", property_id: "prop-1", description: "ACE" }),
          line({ id: "r2", business_domain: "property_management", property_id: "prop-1", category: "תיקונים", description: "מכונת כביסה" }),
        ],
        error: null,
      },
      expenses: { read: { data: null, error: null }, write: { data: [{ id: "e2" }], error: null } },
    });
    grant(supabase);
    const res = await post();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ created: 1 });
    expect(json.errors).toEqual([{ id: "r1", message: "חסרה קטגוריה של נכס (ACE)" }]);
    const [created] = supabase.calls.insert.expenses as Array<Array<Record<string, unknown>>>;
    expect(created.map((e) => e.category)).toEqual(["תיקונים"]);
  });

  it("skips a refund that already has its income", async () => {
    const supabase = makeSupabase({
      card_statement_rows: { data: [line({ id: "r2", amount: -8.4, income_payment_id: "p-old" })], error: null },
    });
    grant(supabase);

    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 0, refunds: 0 });
    expect(supabase.calls.insert.payments).toBeUndefined();
  });
});
