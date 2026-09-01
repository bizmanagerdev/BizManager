import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for POST /api/payments/delete — the "linked payment must be
// deleted from its own screen" guard (same rule as update), persistence, and
// the audit-log call.

const { requireRouteAccess, logAuditEvent } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ logAuditEvent }));

import { POST } from "@/app/api/payments/delete/route";

type Resp = { data: unknown; error: unknown };

function makeSupabase(responses: Record<string, Resp>) {
  const deleteCalls: string[] = [];
  const from = (table: string) => {
    const resp = responses[table] ?? { data: null, error: null };
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) {
      builder[m] = () => builder;
    }
    builder.delete = () => {
      deleteCalls.push(table);
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve(resp);
    builder.then = (onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(resp).then(onF, onR);
    return builder;
  };
  return { from, deleteCalls };
}

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/payments/delete", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  requireRouteAccess.mockReset();
  logAuditEvent.mockReset();
});

describe("POST /api/payments/delete — auth gate", () => {
  it("returns the gate's response and never deletes when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await post({ id: "pay-1" });
    expect(res.status).toBe(403);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("POST /api/payments/delete — validation", () => {
  it("400 on missing id", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
  });
});

describe("POST /api/payments/delete — the linked-payment guard", () => {
  it("404 when the payment doesn't exist", async () => {
    grant(makeSupabase({ payments: { data: null, error: null } }));
    const res = await post({ id: "pay-1" });
    expect(res.status).toBe(404);
  });

  it("refuses to delete a project-linked payment with no project_id supplied", async () => {
    grant(makeSupabase({ payments: { data: { id: "pay-1", project_id: "proj-1", order_id: null }, error: null } }));
    const res = await post({ id: "pay-1" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("יש למחוק אותו מהמסך המתאים");
  });

  it("refuses to delete an order-linked payment with no project_id supplied", async () => {
    grant(makeSupabase({ payments: { data: { id: "pay-1", project_id: null, order_id: "ord-1" }, error: null } }));
    const res = await post({ id: "pay-1" });
    expect(res.status).toBe(400);
  });

  it("404 when the supplied project_id doesn't match the payment's own", async () => {
    grant(makeSupabase({ payments: { data: { id: "pay-1", project_id: "proj-1", order_id: null }, error: null } }));
    const res = await post({ id: "pay-1", project_id: "proj-2" });
    expect(res.status).toBe(404);
  });

  it("allows deleting a standalone (unlinked) payment with no project_id", async () => {
    const sb = makeSupabase({ payments: { data: { id: "pay-1", project_id: null, order_id: null }, error: null } });
    grant(sb);
    const res = await post({ id: "pay-1" });
    expect(res.status).toBe(200);
    expect(sb.deleteCalls).toEqual(["payments"]);
  });
});

describe("POST /api/payments/delete — persistence & audit", () => {
  it("deletes and logs a 'delete' audit event on success", async () => {
    grant(makeSupabase({ payments: { data: { id: "pay-1", project_id: null, order_id: null }, error: null } }));
    const res = await post({ id: "pay-1" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "payments", action: "delete", recordId: "pay-1", changedBy: "prof-1" })
    );
  });
});
