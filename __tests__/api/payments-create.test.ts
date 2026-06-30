import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for POST /api/payments/create — validation, persistence, the
// audit-log call, and Hebrew error mapping. Every external dependency is mocked;
// the fake Supabase client is injected through the (mocked) auth gate.

const { requireRouteAccess, logAuditEvent, tryAutoIssueReceiptForPayment, syncEntityTags } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  logAuditEvent: vi.fn(),
  tryAutoIssueReceiptForPayment: vi.fn(async () => ({ ok: true, skipped: true, reason: null, morningDocumentId: null })),
  syncEntityTags: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
// Idempotency wrapper is transparent here — just run the handler.
vi.mock("@/lib/idempotency", () => ({
  withIdempotency: (_req: unknown, _sb: unknown, _uid: unknown, _ep: unknown, handler: () => Promise<unknown>) =>
    handler(),
}));
vi.mock("@/lib/audit", () => ({ logAuditEvent }));
vi.mock("@/lib/morning/service", () => ({ tryAutoIssueReceiptForPayment }));
vi.mock("@/lib/tags", () => ({ parseTagIds: () => [], syncEntityTags }));
vi.mock("@/lib/settings/vat", () => ({ getCurrentVatRate: async () => 18 }));

import { POST } from "@/app/api/payments/create/route";

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
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/payments/create", { method: "POST", body: JSON.stringify(body) }));
}

const VALID = {
  amount_total: 1000,
  payment_date: "2024-05-01",
  payment_method: "bank_transfer",
  business_domain: "sales",
};

beforeEach(() => {
  requireRouteAccess.mockReset();
  logAuditEvent.mockReset();
  syncEntityTags.mockReset();
  tryAutoIssueReceiptForPayment.mockClear();
});

describe("POST /api/payments/create — auth gate", () => {
  it("returns the gate's response and never persists when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await post(VALID);
    expect(res.status).toBe(403);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("POST /api/payments/create — validation", () => {
  beforeEach(() => grant(makeSupabase({ payments: { data: { id: "pay-1" }, error: null } })));

  it("400 on missing/invalid amount", async () => {
    const res = await post({ ...VALID, amount_total: 0 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/amount_total/);
  });

  it("400 on missing payment_date or method", async () => {
    const res = await post({ ...VALID, payment_method: "" });
    expect(res.status).toBe(400);
  });

  it("400 on a check with no due_date", async () => {
    const res = await post({ ...VALID, payment_method: "check", due_date: null });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/due_date/);
  });

  it("400 when more than one source is linked", async () => {
    const res = await post({ ...VALID, project_id: "p1", order_id: "o1" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/payments/create — persistence & audit", () => {
  it("persists and logs an audit event on success", async () => {
    grant(makeSupabase({ payments: { data: { id: "pay-1" }, error: null } }));
    const res = await post(VALID);
    expect(res.status).toBe(200);
    expect((await res.json()).payment).toEqual({ id: "pay-1" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "payments", action: "create", recordId: "pay-1", changedBy: "prof-1", userRole: "admin" })
    );
  });

  it("404 when a linked project does not exist", async () => {
    grant(makeSupabase({ projects: { data: null, error: null } }));
    const res = await post({ ...VALID, business_domain: undefined, project_id: "missing" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/payments/create — Hebrew error mapping", () => {
  it("maps a DB unique-violation to a Hebrew message", async () => {
    grant(makeSupabase({ payments: { data: null, error: { message: "duplicate key value violates unique constraint" } } }));
    const res = await post(VALID);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("הערך כבר קיים במערכת.");
  });
});
