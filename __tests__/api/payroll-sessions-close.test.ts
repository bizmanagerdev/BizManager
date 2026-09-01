import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/payroll/sessions/close — clocking an open
// session out. Same locked-period guard as delete, plus its own: can't
// close an already-closed session, and clock_out must be after clock_in.
// Deliberately nulls labor_cost on close (rather than computing it inline)
// so the subsequent recalculateUserSessionCostsFromRules call is the one
// source of truth for the actual amount.

const { requireRouteAccess, recalculateUserSessionCostsFromRules } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  recalculateUserSessionCostsFromRules: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/payroll-center", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payroll-center")>();
  return { ...actual, recalculateUserSessionCostsFromRules };
});

import { POST } from "@/app/api/payroll/sessions/close/route";

const OPEN_SESSION = { id: "sess-1", user_id: "u1", clock_in: "2026-05-15T08:00:00", clock_out: null };
const OPEN_PERIOD = { id: "per-1", period_month: "2026-05", start_date: "2026-05-01", end_date: "2026-05-31", status: "open" };
const WORKER = { id: "u1", payroll_worker_type: "hourly_payslip", pay_tracking_mode: "session" };

function sb(opts: { session?: unknown; periods?: unknown[]; worker?: unknown } = {}) {
  return makeSupabase({
    attendance_sessions: { data: "session" in opts ? opts.session : OPEN_SESSION, error: null },
    payroll_periods: { data: opts.periods ?? [OPEN_PERIOD], error: null },
    users: { data: opts.worker ?? WORKER, error: null },
  });
}

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/payroll/sessions/close", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  requireRouteAccess.mockReset();
  recalculateUserSessionCostsFromRules.mockClear();
});

describe("POST /api/payroll/sessions/close — auth gate", () => {
  it("requests the admin/office gate", async () => {
    grant(sb());
    await post({ session_id: "sess-1" });
    expect(requireRouteAccess).toHaveBeenCalledWith({ allowedRoles: ["admin", "office"] });
  });

  it("returns the gate's response when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await post({ session_id: "sess-1" });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/payroll/sessions/close — validation", () => {
  it("400 on missing session_id", async () => {
    grant(sb());
    expect((await post({})).status).toBe(400);
  });

  it("404 when the session doesn't exist", async () => {
    grant(sb({ session: null }));
    expect((await post({ session_id: "sess-1" })).status).toBe(404);
  });

  it("409s a session inside a locked payroll period", async () => {
    const database = sb({ periods: [{ ...OPEN_PERIOD, status: "locked" }] });
    grant(database);
    const res = await post({ session_id: "sess-1" });
    expect(res.status).toBe(409);
  });

  it("400s a session that's already closed", async () => {
    grant(sb({ session: { ...OPEN_SESSION, clock_out: "2026-05-15T16:00:00" } }));
    const res = await post({ session_id: "sess-1" });
    expect(res.status).toBe(400);
  });

  it("400s when the given clock_out is before (or equal to) clock_in", async () => {
    grant(sb());
    const res = await post({ session_id: "sess-1", clock_out: "2026-05-15T07:00:00" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/payroll/sessions/close — persistence", () => {
  it("sets clock_out/worked_minutes and NULLS labor_cost (the recalc call fills it in), then recalculates", async () => {
    const database = sb();
    grant(database);
    const res = await post({ session_id: "sess-1", clock_out: "2026-05-15T16:00:00" });
    expect(res.status).toBe(200);
    expect(database.calls.update.attendance_sessions[0]).toMatchObject({
      clock_out: "2026-05-15T16:00:00",
      worked_minutes: 480,
      labor_cost: null,
    });
    expect(recalculateUserSessionCostsFromRules).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      expect.objectContaining({ fromDate: "2026-05-15" })
    );
  });

  it("defaults clock_out to now when none is given", async () => {
    const database = sb();
    grant(database);
    const res = await post({ session_id: "sess-1" });
    expect(res.status).toBe(200);
    expect(database.calls.update.attendance_sessions[0]).toMatchObject({ clock_out: expect.any(String) });
  });
});
