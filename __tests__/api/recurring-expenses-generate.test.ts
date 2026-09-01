import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for POST /api/recurring-expenses/generate — the daily-run
// trigger (calls the generate_recurring_expenses_for_date RPC). Worth
// locking down: the admin/office gate, the createdCount coercion (the RPC
// can return a number OR a numeric string depending on the PG function's
// declared return type), and the specific "missing schema" message for a
// not-yet-migrated database (distinct from a generic DB error).

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));

import { POST } from "@/app/api/recurring-expenses/generate/route";

function grant(rpcResult: { data: unknown; error: unknown }) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: {
      supabase: { rpc: vi.fn(async () => rpcResult) },
      user: { id: "auth-1" },
      profile: { id: "prof-1", role: "admin" },
    },
  });
}

beforeEach(() => requireRouteAccess.mockReset());

describe("POST /api/recurring-expenses/generate", () => {
  it("returns the gate's response when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await POST();
    expect(res.status).toBe(403);
  });

  it("coerces a numeric createdCount", async () => {
    grant({ data: 4, error: null });
    const res = await POST();
    expect(res.status).toBe(200);
    expect((await res.json()).createdCount).toBe(4);
  });

  it("coerces a string createdCount (some PG return types come back as text)", async () => {
    grant({ data: "7", error: null });
    const res = await POST();
    expect((await res.json()).createdCount).toBe(7);
  });

  it("falls back to 0 for an unparseable createdCount", async () => {
    grant({ data: "not-a-number", error: null });
    const res = await POST();
    expect((await res.json()).createdCount).toBe(0);
  });

  it("reports a specific message when the RPC/schema doesn't exist yet", async () => {
    grant({ data: null, error: { message: 'function "generate_recurring_expenses_for_date" does not exist' } });
    const res = await POST();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing recurring expense schema");
  });

  it("maps any other RPC error to a Hebrew message", async () => {
    grant({ data: null, error: { message: "connection reset" } });
    const res = await POST();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });
});
