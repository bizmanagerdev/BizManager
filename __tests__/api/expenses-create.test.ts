import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for POST /api/expenses/create — validation, persistence, the
// audit-log call, project-link rollback, and Hebrew error mapping.

const { requireRouteAccess, logAuditEvent, syncEntityTags } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  logAuditEvent: vi.fn(),
  syncEntityTags: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/idempotency", () => ({
  withIdempotency: (_req: unknown, _sb: unknown, _uid: unknown, _ep: unknown, handler: () => Promise<unknown>) =>
    handler(),
}));
vi.mock("@/lib/audit", () => ({ logAuditEvent }));
vi.mock("@/lib/tags", () => ({ parseTagIds: () => [], syncEntityTags }));

import { POST } from "@/app/api/expenses/create/route";

type Resp = { data: unknown; error: unknown };

function makeSupabase(responses: Record<string, Resp>, calls: string[] = []) {
  const from = (table: string) => {
    const resp = responses[table] ?? { data: null, error: null };
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "insert", "update", "delete", "eq", "not", "gte", "in", "order", "limit"]) {
      builder[m] = (..._args: unknown[]) => {
        calls.push(`${table}.${m}`);
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve(resp);
    builder.then = (onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(resp).then(onF, onR);
    return builder;
  };
  return { from };
}

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "office" } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/expenses/create", { method: "POST", body: JSON.stringify(body) }));
}

const VALID = {
  category: "חומרים",
  amount: 250,
  expense_date: "2024-05-01",
  business_domain: "sales",
};

beforeEach(() => {
  requireRouteAccess.mockReset();
  logAuditEvent.mockReset();
  syncEntityTags.mockReset();
});

describe("POST /api/expenses/create — auth gate", () => {
  it("returns the gate's response when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await post(VALID);
    expect(res.status).toBe(403);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("POST /api/expenses/create — validation (Hebrew messages)", () => {
  beforeEach(() => grant(makeSupabase({ expenses: { data: { id: "e-1" }, error: null } })));

  it("400 + Hebrew when category or amount is missing", async () => {
    const res = await post({ ...VALID, category: "" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("יש להזין קטגוריה וסכום.");
  });

  it("400 + Hebrew when expense_date is missing", async () => {
    const res = await post({ ...VALID, expense_date: null });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("יש להזין תאריך להוצאה.");
  });

  it("400 when more than one source is linked", async () => {
    const res = await post({ ...VALID, project_id: "p1", property_id: "pr1" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/מקור אחד/);
  });

  it("400 + Hebrew when the business domain is invalid", async () => {
    const res = await post({ ...VALID, business_domain: "nonsense" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("יש לבחור תחום עסקי.");
  });
});

describe("POST /api/expenses/create — persistence & audit", () => {
  it("persists and logs an audit event on success", async () => {
    grant(makeSupabase({ expenses: { data: { id: "e-1", amount: 250 }, error: null } }));
    const res = await post(VALID);
    expect(res.status).toBe(200);
    expect((await res.json()).expense).toMatchObject({ id: "e-1" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "expenses", action: "create", recordId: "e-1", changedBy: "prof-1", userRole: "office" })
    );
  });

  it("maps a DB error on the expense insert to Hebrew", async () => {
    grant(makeSupabase({ expenses: { data: null, error: { message: "violates foreign key constraint" } } }));
    const res = await post(VALID);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("לא ניתן לבצע את הפעולה — קיים קישור לרשומה אחרת.");
  });
});

describe("POST /api/expenses/create — project link rollback", () => {
  it("deletes the expense when the project_expenses link fails", async () => {
    const calls: string[] = [];
    grant(
      makeSupabase(
        {
          projects: { data: { id: "p1", project_type: null }, error: null },
          expenses: { data: { id: "e-1" }, error: null },
          project_expenses: { data: null, error: { message: "boom" } },
        },
        calls
      )
    );
    const res = await post({ ...VALID, project_id: "p1" });
    expect(res.status).toBe(400);
    // The orphaned expense must be rolled back.
    expect(calls).toContain("expenses.delete");
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
