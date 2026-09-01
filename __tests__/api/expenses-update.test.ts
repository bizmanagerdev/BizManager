import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/expenses/update — validation, the locked-
// source guards (project_id/order_id can't move once set; property_id CAN,
// per the route's own 2026-08-27 comment), the locked-business-domain
// derivation, the payment_status/paid_amount/payment_method conditional
// logic, persistence to both expenses and project_expenses, and audit+tags.

const { requireRouteAccess, logAuditEvent, syncEntityTags } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  logAuditEvent: vi.fn(),
  syncEntityTags: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ logAuditEvent }));
vi.mock("@/lib/tags", () => ({ parseTagIds: () => [], syncEntityTags }));

import { POST } from "@/app/api/expenses/update/route";

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/expenses/update", { method: "POST", body: JSON.stringify(body) }));
}

const VALID = {
  id: "exp-1",
  category: "חומרי בניין",
  amount: 500,
  expense_date: "2026-05-01",
};

/** A standalone expense — no project/order link, so validation and the
 *  business-domain lock don't gate on those. */
function standaloneExpenseRow(overrides: Record<string, unknown> = {}) {
  return { id: "exp-1", project_id: null, order_id: null, property_id: null, business_domain: "general_business", ...overrides };
}

function sb(expenseRow: Record<string, unknown> | null, opts: { expenseWrite?: unknown; projectExpenseRow?: unknown } = {}) {
  return makeSupabase({
    expenses: { read: { data: expenseRow, error: null }, write: (opts.expenseWrite as never) ?? { data: { id: "exp-1" }, error: null } },
    project_expenses: { data: opts.projectExpenseRow ?? null, error: null },
  });
}

beforeEach(() => {
  requireRouteAccess.mockReset();
  logAuditEvent.mockReset();
  syncEntityTags.mockReset();
});

describe("POST /api/expenses/update — auth gate", () => {
  it("returns the gate's response and never persists when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await post(VALID);
    expect(res.status).toBe(403);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("POST /api/expenses/update — validation", () => {
  it("400 on missing id", async () => {
    expect((await post({ ...VALID, id: undefined })).status).toBe(400);
  });

  it("400 on missing category or invalid amount", async () => {
    expect((await post({ ...VALID, category: "" })).status).toBe(400);
    expect((await post({ ...VALID, amount: 0 })).status).toBe(400);
  });

  it("400 on missing expense_date", async () => {
    expect((await post({ ...VALID, expense_date: null })).status).toBe(400);
  });

  it("400 when more than one source is linked", async () => {
    const res = await post({ ...VALID, project_id: "p1", order_id: "o1" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/expenses/update — the locked-source guards", () => {
  it("404 when the expense doesn't exist", async () => {
    grant(sb(null));
    expect((await post(VALID)).status).toBe(404);
  });

  it("404 when the supplied project_id doesn't match the expense's own (project is locked, unlike property)", async () => {
    grant(sb(standaloneExpenseRow({ project_id: "proj-1", business_domain: "logistics_projects" })));
    const res = await post({ ...VALID, project_id: "proj-2" });
    expect(res.status).toBe(404);
  });

  it("404 when the expense IS project-linked but no project_id is supplied", async () => {
    grant(sb(standaloneExpenseRow({ project_id: "proj-1", business_domain: "logistics_projects" })));
    const res = await post(VALID);
    expect(res.status).toBe(404);
  });

  it("allows freely reassigning property_id — no mismatch guard for it", async () => {
    const database = sb(standaloneExpenseRow({ property_id: "prop-old", business_domain: "property_management" }));
    grant(database);
    const res = await post({ ...VALID, property_id: "prop-new" });
    expect(res.status).toBe(200);
    expect(database.calls.update.expenses[0]).toMatchObject({ property_id: "prop-new" });
  });
});

describe("POST /api/expenses/update — the locked business-domain", () => {
  it("400 when the caller's domain contradicts a project-linked expense's locked domain", async () => {
    grant(sb(standaloneExpenseRow({ project_id: "proj-1", business_domain: "logistics_projects" })));
    const res = await post({ ...VALID, project_id: "proj-1", business_domain: "general_business" });
    expect(res.status).toBe(400);
  });

  it("400 when business_domain=property_management but no property is chosen", async () => {
    grant(sb(standaloneExpenseRow()));
    const res = await post({ ...VALID, business_domain: "property_management" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/expenses/update — payment_status/paid_amount/payment_method logic", () => {
  it("keeps paid_amount only when status is 'partial' with a positive value", async () => {
    const database = sb(standaloneExpenseRow());
    grant(database);
    await post({ ...VALID, payment_status: "partial", paid_amount: 200, payment_method: "cash" });
    expect(database.calls.update.expenses[0]).toMatchObject({ payment_status: "partial", paid_amount: 200, payment_method: "cash" });
  });

  it("drops paid_amount when status is 'paid' (the field is 'partial'-only)", async () => {
    const database = sb(standaloneExpenseRow());
    grant(database);
    await post({ ...VALID, payment_status: "paid", paid_amount: 200, payment_method: "cash" });
    expect(database.calls.update.expenses[0]).toMatchObject({ payment_status: "paid", paid_amount: null, payment_method: "cash" });
  });

  it("drops payment_method entirely when there's no payment_status", async () => {
    const database = sb(standaloneExpenseRow());
    grant(database);
    await post({ ...VALID, payment_method: "cash" });
    expect(database.calls.update.expenses[0]).toMatchObject({ payment_status: null, payment_method: null });
  });

  it("ignores an unrecognized payment_status value", async () => {
    const database = sb(standaloneExpenseRow());
    grant(database);
    await post({ ...VALID, payment_status: "made-up-status" });
    expect(database.calls.update.expenses[0]).toMatchObject({ payment_status: null });
  });
});

describe("POST /api/expenses/update — persistence & audit", () => {
  it("updates expenses only (no project_expenses row) for a standalone expense", async () => {
    const database = sb(standaloneExpenseRow());
    grant(database);
    const res = await post(VALID);
    expect(res.status).toBe(200);
    expect(database.calls.update.expenses).toHaveLength(1);
    expect(database.calls.update.project_expenses ?? []).toHaveLength(0);
  });

  it("also updates the project_expenses row when the expense is project-linked", async () => {
    const database = sb(standaloneExpenseRow({ project_id: "proj-1", business_domain: "logistics_projects" }), {
      projectExpenseRow: { project_id: "proj-1" },
    });
    grant(database);
    const res = await post({
      ...VALID,
      project_id: "proj-1",
      included_in_base_price: true,
      billed_to_customer: true,
      project_expense_notes: "כלול במחיר",
    });
    expect(res.status).toBe(200);
    expect(database.calls.update.project_expenses[0]).toMatchObject({
      included_in_base_price: true,
      billed_to_customer: true,
      notes: "כלול במחיר",
    });
  });

  it("logs an 'update' audit event and syncs tags on success", async () => {
    grant(sb(standaloneExpenseRow()));
    const res = await post(VALID);
    expect(res.status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "expenses", action: "update", recordId: "exp-1", changedBy: "prof-1" })
    );
    expect(syncEntityTags).toHaveBeenCalled();
  });
});

describe("POST /api/expenses/update — Hebrew error mapping", () => {
  it("maps a DB error on the update itself to a Hebrew message", async () => {
    grant(sb(standaloneExpenseRow(), { expenseWrite: { data: null, error: { message: "duplicate key value violates unique constraint" } } }));
    const res = await post(VALID);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("הערך כבר קיים במערכת.");
  });
});
