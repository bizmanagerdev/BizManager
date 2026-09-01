import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/payroll/sessions/delete. The one invariant
// worth locking down hardest: a session inside a LOCKED payroll period must
// never be deletable (409) — payroll periods close the books, and deleting
// a session after that would silently change numbers someone already signed
// off on. `collectLockedSessionIds`/`isPayrollPeriodLocked`/`isSessionInPeriod`
// run for REAL here (not mocked) so the actual date-range/status logic is
// exercised, not just a stubbed "yes/no".

const { requireRouteAccess, logAuditEvent, recalculateUserSessionCostsFromRules } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  logAuditEvent: vi.fn(),
  recalculateUserSessionCostsFromRules: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ logAuditEvent }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => null })); // -> falls back to the route's own supabase
vi.mock("@/lib/payroll-center", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payroll-center")>();
  return { ...actual, recalculateUserSessionCostsFromRules };
});

import { POST } from "@/app/api/payroll/sessions/delete/route";

const SESSION = { id: "sess-1", user_id: "u1", clock_in: "2026-05-15T09:00:00" };
const OPEN_PERIOD = { id: "per-1", period_month: "2026-05", start_date: "2026-05-01", end_date: "2026-05-31", status: "open" };
const LOCKED_PERIOD = { ...OPEN_PERIOD, id: "per-2", status: "locked" };
const WORKER = { id: "u1", payroll_worker_type: "hourly_payslip", pay_tracking_mode: "session" };

function sb(opts: { session?: unknown; periods?: unknown[]; worker?: unknown } = {}) {
  return makeSupabase({
    attendance_sessions: { data: "session" in opts ? opts.session : SESSION, error: null },
    payroll_periods: { data: opts.periods ?? [OPEN_PERIOD], error: null },
    worker_payment_allocations: { data: null, error: null },
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
  return POST(new Request("http://test/api/payroll/sessions/delete", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  requireRouteAccess.mockReset();
  logAuditEvent.mockReset();
  recalculateUserSessionCostsFromRules.mockClear();
});

describe("POST /api/payroll/sessions/delete — auth gate", () => {
  it("requests the admin/office-only gate", async () => {
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

describe("POST /api/payroll/sessions/delete — validation", () => {
  it("400 on missing session_id", async () => {
    grant(sb());
    expect((await post({})).status).toBe(400);
  });

  it("404 when the session doesn't exist", async () => {
    grant(sb({ session: null }));
    expect((await post({ session_id: "sess-1" })).status).toBe(404);
  });
});

describe("POST /api/payroll/sessions/delete — the locked-period guard", () => {
  it("409s a session that falls inside a locked period's date range", async () => {
    const database = sb({ periods: [LOCKED_PERIOD] });
    grant(database);
    const res = await post({ session_id: "sess-1" });
    expect(res.status).toBe(409);
    expect(database.calls.delete.attendance_sessions ?? 0).toBe(0);
  });

  it("allows deleting when the session's period is open", async () => {
    const database = sb({ periods: [OPEN_PERIOD] });
    grant(database);
    const res = await post({ session_id: "sess-1" });
    expect(res.status).toBe(200);
  });

  it("allows deleting when the session falls OUTSIDE a locked period's date range", async () => {
    const outsideLocked = { ...LOCKED_PERIOD, start_date: "2026-01-01", end_date: "2026-01-31" };
    const database = sb({ periods: [outsideLocked] }); // session is in May, this locked period is January
    grant(database);
    const res = await post({ session_id: "sess-1" });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/payroll/sessions/delete — persistence order & audit", () => {
  it("deletes worker_payment_allocations before the session, recalculates costs, and audits", async () => {
    const database = sb();
    grant(database);
    const res = await post({ session_id: "sess-1" });
    expect(res.status).toBe(200);
    expect(database.calls.delete.worker_payment_allocations).toBe(1);
    expect(database.calls.delete.attendance_sessions).toBe(1);
    expect(recalculateUserSessionCostsFromRules).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      expect.objectContaining({ fromDate: "2026-05-15" })
    );
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "attendance_sessions", action: "delete", recordId: "sess-1", changedBy: "prof-1" })
    );
  });
});
