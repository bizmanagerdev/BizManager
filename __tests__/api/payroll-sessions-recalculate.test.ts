import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/payroll/sessions/recalculate. Distinct from
// every other payroll/sessions route: it's gated to admin ONLY, not
// admin/office — a manual cost recalculation is a step above the usual
// office-level session edits.

const { requireRouteAccess, recalculateUserSessionCostsFromRules } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  recalculateUserSessionCostsFromRules: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/payroll-center", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payroll-center")>();
  return { ...actual, recalculateUserSessionCostsFromRules };
});

import { POST } from "@/app/api/payroll/sessions/recalculate/route";

const SESSION = { id: "sess-1", user_id: "u1", clock_in: "2026-05-15T08:00:00", clock_out: "2026-05-15T16:00:00" };
const OPEN_PERIOD = { id: "per-1", period_month: "2026-05", start_date: "2026-05-01", end_date: "2026-05-31", status: "open" };
const WORKER = { id: "u1", payroll_worker_type: "hourly_payslip", pay_tracking_mode: "session" };

function sb(opts: { session?: unknown; periods?: unknown[]; worker?: unknown } = {}) {
  return makeSupabase({
    attendance_sessions: { data: "session" in opts ? opts.session : SESSION, error: null },
    payroll_periods: { data: opts.periods ?? [OPEN_PERIOD], error: null },
    users: { data: opts.worker ?? WORKER, error: null },
  });
}

function grant(supabase: unknown, role = "admin") {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/payroll/sessions/recalculate", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  requireRouteAccess.mockReset();
  recalculateUserSessionCostsFromRules.mockClear();
});

describe("POST /api/payroll/sessions/recalculate — auth gate", () => {
  it("requests the admin-ONLY gate, not admin/office", async () => {
    grant(sb());
    await post({ session_id: "sess-1" });
    expect(requireRouteAccess).toHaveBeenCalledWith({ allowedRoles: ["admin"] });
  });

  it("returns the gate's response when access is denied (e.g. office, not just worker)", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await post({ session_id: "sess-1" });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/payroll/sessions/recalculate — validation & guards", () => {
  it("400 on missing session_id", async () => {
    grant(sb());
    expect((await post({})).status).toBe(400);
  });

  it("404 when the session doesn't exist", async () => {
    grant(sb({ session: null }));
    expect((await post({ session_id: "sess-1" })).status).toBe(404);
  });

  it("409s a session inside a locked payroll period — recalculating can't touch closed-book numbers", async () => {
    const database = sb({ periods: [{ ...OPEN_PERIOD, status: "locked" }] });
    grant(database);
    const res = await post({ session_id: "sess-1" });
    expect(res.status).toBe(409);
    expect(recalculateUserSessionCostsFromRules).not.toHaveBeenCalled();
  });
});

describe("POST /api/payroll/sessions/recalculate — persistence", () => {
  it("recalculates from the session's own clock-in date and regenerates payslips for a payslip-generating worker type", async () => {
    const database = sb();
    grant(database);
    const res = await post({ session_id: "sess-1" });
    expect(res.status).toBe(200);
    expect(recalculateUserSessionCostsFromRules).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      expect.objectContaining({ fromDate: "2026-05-15", regeneratePayslips: true })
    );
  });

  it("does not regenerate payslips for a session-only (non-payslip) worker type", async () => {
    const database = sb({ worker: { ...WORKER, payroll_worker_type: "session_only" } });
    grant(database);
    await post({ session_id: "sess-1" });
    expect(recalculateUserSessionCostsFromRules).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      expect.objectContaining({ regeneratePayslips: false })
    );
  });
});
