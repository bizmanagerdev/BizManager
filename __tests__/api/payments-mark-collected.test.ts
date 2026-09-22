import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// POST /api/payments/mark-collected — the money arrived. For a check that also
// answers WHERE it was deposited: the account chosen when the check was
// recorded is the default, and the deposit is where it can still change.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ logAuditEvent: vi.fn(async () => {}) }));

import { POST } from "@/app/api/payments/mark-collected/route";

const RECORDED = "11111111-1111-4111-8111-111111111111";
const DEPOSITED = "22222222-2222-4222-8222-222222222222";

function sb(over: Record<string, unknown> = {}) {
  return makeSupabase({
    payments: {
      read: { data: { id: "p1", order_id: null, project_id: null, payment_status: "pending", account_id: RECORDED, ...over }, error: null },
      write: { data: null, error: null },
    },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/payments/mark-collected", { method: "POST", body: JSON.stringify(body) }));
}

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}

beforeEach(() => requireRouteAccess.mockReset());

describe("POST /api/payments/mark-collected", () => {
  it("marks it collected and leaves the account alone when none is sent", async () => {
    const supabase = sb();
    grant(supabase);
    expect((await post({ id: "p1", collected: true })).status).toBe(200);
    expect(supabase.calls.update.payments).toEqual([{ payment_status: "cleared" }]);
  });

  it("files it in the account it was actually deposited into", async () => {
    const supabase = sb();
    grant(supabase);
    expect((await post({ id: "p1", collected: true, account_id: DEPOSITED })).status).toBe(200);
    expect(supabase.calls.update.payments).toEqual([{ payment_status: "cleared", account_id: DEPOSITED }]);
  });

  it("writes nothing extra when the account is the one already on the check", async () => {
    const supabase = sb();
    grant(supabase);
    await post({ id: "p1", collected: true, account_id: RECORDED });
    expect(supabase.calls.update.payments).toEqual([{ payment_status: "cleared" }]);
  });

  it("never moves the account on an undo, and rejects a bad id", async () => {
    const supabase = sb({ payment_status: "cleared" });
    grant(supabase);
    await post({ id: "p1", collected: false, account_id: DEPOSITED });
    expect(supabase.calls.update.payments).toEqual([{ payment_status: "pending" }]);

    const bad = sb();
    grant(bad);
    expect((await post({ id: "p1", collected: true, account_id: "not-an-id" })).status).toBe(400);
    expect(bad.calls.update.payments).toBeUndefined();
  });
});
