import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/expenses/delete — the source-mismatch guards
// (project/order/property, all three unlike payments/delete's project+order
// only), the delete ORDER (project_expenses before expenses, since the join
// row FKs to the expense), and the audit-log call.

const { requireRouteAccess, logAuditEvent } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ logAuditEvent }));

import { POST } from "@/app/api/expenses/delete/route";

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/expenses/delete", { method: "POST", body: JSON.stringify(body) }));
}

function sb(expenseRow: Record<string, unknown> | null, opts: { projectExpenseRow?: unknown; deleteError?: unknown } = {}) {
  return makeSupabase({
    expenses: {
      read: { data: expenseRow, error: null },
      write: { data: null, error: opts.deleteError === "expenses" ? { message: "boom" } : null },
    },
    project_expenses: {
      read: { data: opts.projectExpenseRow ?? null, error: null },
      write: { data: null, error: opts.deleteError === "project_expenses" ? { message: "boom" } : null },
    },
  });
}

beforeEach(() => {
  requireRouteAccess.mockReset();
  logAuditEvent.mockReset();
});

describe("POST /api/expenses/delete — auth gate", () => {
  it("returns the gate's response and never deletes when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await post({ id: "exp-1" });
    expect(res.status).toBe(403);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("POST /api/expenses/delete — validation", () => {
  it("400 on missing id", async () => {
    expect((await post({})).status).toBe(400);
  });

  it("400 when more than one source is supplied", async () => {
    const res = await post({ id: "exp-1", project_id: "p1", order_id: "o1" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/expenses/delete — the source-mismatch guards", () => {
  it("404 when the expense doesn't exist", async () => {
    grant(sb(null));
    expect((await post({ id: "exp-1" })).status).toBe(404);
  });

  it.each([
    ["project_id", { project_id: "proj-1" }, "proj-other"],
    ["order_id", { order_id: "ord-1" }, "ord-other"],
    ["property_id", { property_id: "prop-1" }, "prop-other"],
  ])("404 when the supplied %s doesn't match the expense's own", async (field, existing, wrongValue) => {
    grant(sb({ id: "exp-1", project_id: null, order_id: null, property_id: null, ...existing }));
    const res = await post({ id: "exp-1", [field]: wrongValue });
    expect(res.status).toBe(404);
  });

  it("404 when the expense IS linked to a source but none is supplied", async () => {
    grant(sb({ id: "exp-1", project_id: "proj-1", order_id: null, property_id: null }));
    const res = await post({ id: "exp-1" });
    expect(res.status).toBe(404);
  });

  it("succeeds for a standalone expense with no source supplied", async () => {
    grant(sb({ id: "exp-1", project_id: null, order_id: null, property_id: null }));
    const res = await post({ id: "exp-1" });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/expenses/delete — persistence order & audit", () => {
  it("deletes project_expenses before expenses (the join row FKs to the expense)", async () => {
    const database = sb({ id: "exp-1", project_id: null, order_id: null, property_id: null });
    grant(database);
    const res = await post({ id: "exp-1" });
    expect(res.status).toBe(200);
    expect(database.calls.delete.project_expenses).toBe(1);
    expect(database.calls.delete.expenses).toBe(1);
  });

  it("logs a 'delete' audit event on success", async () => {
    grant(sb({ id: "exp-1", project_id: null, order_id: null, property_id: null }));
    const res = await post({ id: "exp-1" });
    expect(res.status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "expenses", action: "delete", recordId: "exp-1", changedBy: "prof-1" })
    );
  });
});

describe("POST /api/expenses/delete — error mapping", () => {
  it("stops and reports when deleting the project_expenses row fails, without deleting the expense", async () => {
    const database = sb(
      { id: "exp-1", project_id: null, order_id: null, property_id: null },
      { deleteError: "project_expenses" }
    );
    grant(database);
    const res = await post({ id: "exp-1" });
    expect(res.status).toBe(400);
    expect(database.calls.delete.expenses ?? 0).toBe(0);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("reports when deleting the expense itself fails", async () => {
    grant(sb({ id: "exp-1", project_id: null, order_id: null, property_id: null }, { deleteError: "expenses" }));
    const res = await post({ id: "exp-1" });
    expect(res.status).toBe(400);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
