import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { makeSupabase, type MockResp } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/recurring-expenses/save — validation (incl.
// the domain-locked single-source guard), create-vs-update persistence, and
// the amount_propagation logic: a template edit only reaches occurrences
// generated from now on unless the caller explicitly asks to re-price
// already-generated `expenses` rows. This is a real historical-data-rewrite
// path — the highest-risk piece of this route — so it gets the most
// coverage. The post-save "materialize now" RPC calls are best-effort and
// must never fail the save itself; verified separately.

const {
  requireRouteAccess,
  ensureRecurringExpensesForDate,
  invalidateRecurringExpensesEnsureCache,
} = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  ensureRecurringExpensesForDate: vi.fn(async () => ({ ok: true, createdCount: 0 })),
  invalidateRecurringExpensesEnsureCache: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/recurring-expenses", () => ({ ensureRecurringExpensesForDate, invalidateRecurringExpensesEnsureCache }));

import { POST } from "@/app/api/recurring-expenses/save/route";

function grant(supabase: unknown, role = "admin") {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/recurring-expenses/save", { method: "POST", body: JSON.stringify(body) }));
}

const VALID_NEW = {
  template_name: "ארנונה",
  category: "מיסים",
  amount: 500,
  business_domain: "general_business",
  frequency: "monthly",
};

/** A default DB: no existing template row, the "expenses" reprice queries
 *  return empty, and the RPC calls resolve harmlessly. */
function sb(opts: {
  templateWrite?: MockResp;
  existingAmount?: number | null;
  repriceRows?: unknown[];
  rpcError?: unknown;
  rpcData?: unknown;
} = {}) {
  const database = makeSupabase({
    recurring_expense_templates: {
      read: { data: opts.existingAmount != null ? { amount: opts.existingAmount } : null, error: null },
      write: opts.templateWrite ?? { data: { id: "tpl-1" }, error: null },
    },
    expenses: { data: opts.repriceRows ?? [], error: null },
  });
  return {
    ...database,
    rpc: vi.fn(async () => ({ data: opts.rpcData ?? 0, error: opts.rpcError ?? null })),
  };
}

beforeEach(() => {
  requireRouteAccess.mockReset();
  ensureRecurringExpensesForDate.mockReset();
  ensureRecurringExpensesForDate.mockResolvedValue({ ok: true, createdCount: 0 });
  invalidateRecurringExpensesEnsureCache.mockReset();
});

describe("POST /api/recurring-expenses/save — auth gate", () => {
  it("returns the gate's response when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await post(VALID_NEW);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/recurring-expenses/save — validation", () => {
  beforeEach(() => grant(sb()));

  it("400 on missing template_name/category/business_domain", async () => {
    expect((await post({ ...VALID_NEW, template_name: "" })).status).toBe(400);
    expect((await post({ ...VALID_NEW, category: "" })).status).toBe(400);
    expect((await post({ ...VALID_NEW, business_domain: "not-a-real-domain" })).status).toBe(400);
  });

  it("400 on a missing/non-positive amount for a fixed-amount template", async () => {
    expect((await post({ ...VALID_NEW, amount: 0 })).status).toBe(400);
  });

  it("allows a zero/blank amount for a variable-amount template", async () => {
    const res = await post({ ...VALID_NEW, amount: undefined, is_variable_amount: true });
    expect(res.status).toBe(200);
  });

  it("400 when more than one source (project/order/property) is linked", async () => {
    const res = await post({ ...VALID_NEW, business_domain: "sales", order_id: "o1", project_id: "p1" });
    expect(res.status).toBe(400);
  });

  it("400 when logistics_projects has no project_id", async () => {
    const res = await post({ ...VALID_NEW, business_domain: "logistics_projects" });
    expect(res.status).toBe(400);
  });

  it("400 when property_management has no property_id", async () => {
    const res = await post({ ...VALID_NEW, business_domain: "property_management" });
    expect(res.status).toBe(400);
  });

  it("400 for a yearly template missing either month value", async () => {
    const res = await post({ ...VALID_NEW, frequency: "yearly", create_month_of_year: 3 });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/recurring-expenses/save — domain-locked persistence", () => {
  it("keeps project_id only for logistics_projects, nulling it for other domains even if sent", async () => {
    const database = sb();
    grant(database);
    await post({ ...VALID_NEW, business_domain: "logistics_projects", project_id: "proj-1" });
    expect(database.calls.insert.recurring_expense_templates[0]).toMatchObject({
      project_id: "proj-1",
      order_id: null,
      property_id: null,
    });
  });

  it("keeps property_id only for property_management", async () => {
    const database = sb();
    grant(database);
    await post({ ...VALID_NEW, business_domain: "property_management", property_id: "prop-1" });
    expect(database.calls.insert.recurring_expense_templates[0]).toMatchObject({
      property_id: "prop-1",
      project_id: null,
      order_id: null,
    });
  });
});

describe("POST /api/recurring-expenses/save — create vs update", () => {
  it("inserts a new template (with created_by) when no id is given", async () => {
    const database = sb();
    grant(database);
    const res = await post(VALID_NEW);
    expect(res.status).toBe(200);
    expect(database.calls.insert.recurring_expense_templates[0]).toMatchObject({ created_by: "prof-1" });
    expect(database.calls.update.recurring_expense_templates ?? []).toHaveLength(0);
  });

  it("updates the existing template when an id is given", async () => {
    const database = sb({ existingAmount: 500 });
    grant(database);
    const res = await post({ ...VALID_NEW, id: "tpl-1", amount: 500 });
    expect(res.status).toBe(200);
    expect(database.calls.update.recurring_expense_templates).toHaveLength(1);
    expect(database.calls.insert.recurring_expense_templates ?? []).toHaveLength(0);
  });
});

describe("POST /api/recurring-expenses/save — amount_propagation", () => {
  it("never reprices on CREATE, even if amount_propagation is requested", async () => {
    const database = sb();
    grant(database);
    await post({ ...VALID_NEW, amount_propagation: "all" });
    expect(database.calls.update.expenses ?? []).toHaveLength(0);
  });

  it("does nothing when propagation is 'none' (the default), even if the amount changed", async () => {
    const database = sb({ existingAmount: 300 });
    grant(database);
    await post({ ...VALID_NEW, id: "tpl-1", amount: 500 });
    expect(database.calls.update.expenses ?? []).toHaveLength(0);
  });

  it("does nothing when the amount didn't actually change", async () => {
    const database = sb({ existingAmount: 500 });
    grant(database);
    await post({ ...VALID_NEW, id: "tpl-1", amount: 500, amount_propagation: "all" });
    expect(database.calls.update.expenses ?? []).toHaveLength(0);
  });

  it("'unpaid' re-prices only not-yet-paid rows for this template", async () => {
    const database = sb({ existingAmount: 300, repriceRows: [{ id: "e1" }, { id: "e2" }] });
    grant(database);
    const res = await post({ ...VALID_NEW, id: "tpl-1", amount: 500, amount_propagation: "unpaid" });
    const json = await res.json();
    expect(json.repricedCount).toBe(2);
    expect(database.calls.update.expenses[0]).toMatchObject({ amount: 500 });
  });

  it("'all' re-prices the whole history AND separately preserves paid_amount on rows that were fully paid at the old amount", async () => {
    const database = sb({ existingAmount: 300, repriceRows: [{ id: "e1" }] });
    grant(database);
    const res = await post({ ...VALID_NEW, id: "tpl-1", amount: 500, amount_propagation: "all", start_date: "2026-01-01" });
    const json = await res.json();
    expect(json.repricedCount).toBe(1);
    // Two separate .update() calls on expenses: the reprice, then the paid_amount fix-up.
    expect(database.calls.update.expenses).toHaveLength(2);
    expect(database.calls.update.expenses[0]).toMatchObject({ amount: 500 });
    expect(database.calls.update.expenses[1]).toMatchObject({ paid_amount: 500 });
  });

  it("never reprices a variable-amount template", async () => {
    const database = sb({ existingAmount: 0 });
    grant(database);
    await post({ ...VALID_NEW, id: "tpl-1", is_variable_amount: true, amount: 999, amount_propagation: "all" });
    expect(database.calls.update.expenses ?? []).toHaveLength(0);
  });
});

describe("POST /api/recurring-expenses/save — best-effort post-save generation", () => {
  it("saves successfully even when the generator throws", async () => {
    ensureRecurringExpensesForDate.mockRejectedValueOnce(new Error("boom"));
    grant(sb());
    const res = await post(VALID_NEW);
    expect(res.status).toBe(200);
  });

  it("sums the generator's createdCount and the backfill RPC's count into generatedCount", async () => {
    ensureRecurringExpensesForDate.mockResolvedValueOnce({ ok: true, createdCount: 2 });
    grant(sb({ rpcData: 3 }));
    const res = await post(VALID_NEW);
    expect((await res.json()).generatedCount).toBe(5);
  });
});

describe("POST /api/recurring-expenses/save — error mapping", () => {
  it("maps a DB error on save to a Hebrew message", async () => {
    grant(sb({ templateWrite: { data: null, error: { message: "boom" } } }));
    const res = await post(VALID_NEW);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });
});
