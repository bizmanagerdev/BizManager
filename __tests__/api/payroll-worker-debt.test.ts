import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// Contract tests for GET /api/payroll/worker-debt — one worker's debt items for
// the "תשלום לעובד" dialog, with the salary centre's access rules.

const { requireRouteAccess, ensureRecentPayslips } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  ensureRecentPayslips: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/payroll-center", () => ({ ensureRecentPayslips }));

import { GET } from "@/app/api/payroll/worker-debt/route";

const DEBT = [
  { source_type: "session", source_id: "s1", user_id: "w1", owed_amount: 300 },
  { source_type: "payslip", source_id: "", user_id: "w1", owed_amount: 50 }, // no source → dropped
];

function makeSupabase(worker: { id: string; role: string } | null) {
  const debtFilters: Array<[string, unknown]> = [];
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (column: string, value: unknown) => {
      if (table === "worker_debt_items_view") debtFilters.push([column, value]);
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve({ data: worker, error: null });
    builder.range = () => Promise.resolve({ data: DEBT, error: null });
    return builder;
  };
  return { from, debtFilters };
}

function grant(supabase: unknown, role: "admin" | "office") {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "viewer", role } },
  });
}

function get(userId?: string) {
  const url = userId ? `http://test/api/payroll/worker-debt?userId=${userId}` : "http://test/api/payroll/worker-debt";
  return GET(new NextRequest(url));
}

beforeEach(() => {
  requireRouteAccess.mockReset();
  ensureRecentPayslips.mockClear();
});

describe("GET /api/payroll/worker-debt", () => {
  it("returns just that worker's debt rows (rows without a source dropped)", async () => {
    const sb = makeSupabase({ id: "w1", role: "worker" });
    grant(sb, "office");
    const res = await get("w1");
    expect(res.status).toBe(200);
    expect(sb.debtFilters).toContainEqual(["user_id", "w1"]);
    expect((await res.json()).workerDebtItems).toEqual([DEBT[0]]);
  });

  it("gives office an empty list for a user above them (admin/office), like the salary centre", async () => {
    grant(makeSupabase({ id: "a1", role: "admin" }), "office");
    const res = await get("a1");
    expect(res.status).toBe(200);
    expect((await res.json()).workerDebtItems).toEqual([]);
  });

  it("gives an empty list for an inactive / unknown user", async () => {
    grant(makeSupabase(null), "admin");
    const res = await get("gone");
    expect((await res.json()).workerDebtItems).toEqual([]);
  });

  it("400s without a userId", async () => {
    grant(makeSupabase({ id: "w1", role: "worker" }), "admin");
    const res = await get();
    expect(res.status).toBe(400);
  });

  it("passes a refused caller's response straight through", async () => {
    requireRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "No access" }, { status: 403 }),
    });
    const res = await get("w1");
    expect(res.status).toBe(403);
    expect(ensureRecentPayslips).not.toHaveBeenCalled();
  });
});
