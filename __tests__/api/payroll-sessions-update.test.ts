import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for POST /api/payroll/sessions/update — the most complex of
// the payroll/sessions family. Scoped to the distinguishing behaviors: the
// validation/guard cascade (shared shape with create/start), the labor-cost
// resolution rule (an explicit value always wins over a recalc request), and
// — the two things unique to this route — reassigning a session to a
// DIFFERENT worker (whose payslip-generation need is resolved from THEIR OWN
// worker type, looked up separately, not copied from the new worker), and
// the branch split between "recalculate live" (calls
// recalculateUserSessionCostsFromRules) vs. "just regenerate payslips"
// (calls regenerateEditablePayslipsForUsers) depending on whether a
// recalculation actually happened.
//
// Five tables are read in one Promise.all (attendance_sessions twice — the
// target session by id, and its siblings by user_id — plus payroll_periods,
// salary_agreements, users), so this file builds its own small mock rather
// than reusing the shared read/write-only helper.

const { requireRouteAccess, logAuditEvent, recalculateUserSessionCostsFromRules, regenerateEditablePayslipsForUsers } =
  vi.hoisted(() => ({
    requireRouteAccess: vi.fn(),
    logAuditEvent: vi.fn(),
    recalculateUserSessionCostsFromRules: vi.fn(async () => {}),
    regenerateEditablePayslipsForUsers: vi.fn(async () => {}),
  }));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ logAuditEvent }));
vi.mock("@/lib/payroll-center", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payroll-center")>();
  return { ...actual, recalculateUserSessionCostsFromRules, regenerateEditablePayslipsForUsers };
});

import { POST } from "@/app/api/payroll/sessions/update/route";

const SESSION = {
  id: "sess-1",
  user_id: "u1",
  clock_in: "2026-05-15T08:00:00",
  clock_out: "2026-05-15T16:00:00",
  labor_cost: 400,
  is_billable_to_customer: false,
  bill_to_customer_amount: null,
  billing_status: "not_billable",
  notes: null,
  business_domain: "general_business",
  project_id: null,
  property_id: null,
};
const OPEN_PERIOD = { id: "per-1", period_month: "2026-05", start_date: "2026-05-01", end_date: "2026-05-31", status: "open" };
const AGREEMENT = {
  id: "agr-1",
  user_id: "u1",
  salary_type: "hourly",
  hourly_rate: 50,
  monthly_salary: null,
  valid_from: "2026-01-01",
  valid_to: null,
  overtime_rate: 75,
  standard_daily_hours: 8,
};
const HOURLY_WORKER = { id: "u1", payroll_worker_type: "hourly_payslip", pay_tracking_mode: "session" };

type Db = {
  session?: unknown;
  periods?: unknown[];
  siblings?: unknown[];
  agreements?: unknown[];
  workersById?: Record<string, unknown>;
  updateError?: { message: string } | null;
};

function sb(opts: Db = {}) {
  const workersById = opts.workersById ?? { u1: HOURLY_WORKER };
  const calls = { update: [] as unknown[] };

  const from = (table: string) => {
    let filterId: string | null = null;
    let hasNeq = false;
    let wrote = false;
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.order = () => builder;
    builder.range = () => builder;
    builder.eq = (_col: string, value: string) => {
      filterId = value;
      return builder;
    };
    builder.neq = () => {
      hasNeq = true;
      return builder;
    };
    builder.update = (values: unknown) => {
      wrote = true;
      calls.update.push(values);
      return builder;
    };
    const resolve = () => {
      if (table === "attendance_sessions") {
        if (wrote) return { data: opts.session ?? SESSION, error: opts.updateError ?? null };
        if (hasNeq) return { data: opts.siblings ?? [], error: null }; // the siblings-by-user_id query
        return { data: "session" in opts ? opts.session : SESSION, error: null }; // by-id (initial or "refreshed" read)
      }
      if (table === "payroll_periods") return { data: opts.periods ?? [OPEN_PERIOD], error: null };
      if (table === "salary_agreements") return { data: opts.agreements ?? [AGREEMENT], error: null };
      if (table === "users") return { data: (filterId && workersById[filterId]) ?? null, error: null };
      return { data: null, error: null };
    };
    builder.maybeSingle = () => Promise.resolve(resolve());
    builder.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(onF, onR);
    return builder;
  };

  return { from, calls };
}

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/payroll/sessions/update", { method: "POST", body: JSON.stringify(body) }));
}

const VALID = {
  session_id: "sess-1",
  user_id: "u1",
  business_domain: "general_business",
  clock_in: "2026-05-15T08:00:00",
  clock_out: "2026-05-15T16:00:00",
};

beforeEach(() => {
  requireRouteAccess.mockReset();
  logAuditEvent.mockReset();
  recalculateUserSessionCostsFromRules.mockClear();
  regenerateEditablePayslipsForUsers.mockClear();
});

describe("POST /api/payroll/sessions/update — auth gate", () => {
  it("requests the admin/office gate", async () => {
    grant(sb());
    await post(VALID);
    expect(requireRouteAccess).toHaveBeenCalledWith({ allowedRoles: ["admin", "office"] });
  });

  it("returns the gate's response when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    expect((await post(VALID)).status).toBe(403);
  });
});

describe("POST /api/payroll/sessions/update — validation", () => {
  beforeEach(() => grant(sb()));

  it("400 on any missing required field (session/user/domain/clock_in)", async () => {
    expect((await post({ ...VALID, session_id: "" })).status).toBe(400);
    expect((await post({ ...VALID, user_id: "" })).status).toBe(400);
    expect((await post({ ...VALID, business_domain: "" })).status).toBe(400);
    expect((await post({ ...VALID, clock_in: "" })).status).toBe(400);
  });

  it("400 for a billable session with an invalid amount", async () => {
    const res = await post({ ...VALID, is_billable_to_customer: true, bill_to_customer_amount: -5 });
    expect(res.status).toBe(400);
  });

  it("400 when clock_out is before/equal to clock_in", async () => {
    const res = await post({ ...VALID, clock_out: VALID.clock_in });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/payroll/sessions/update — not-found & eligibility guards", () => {
  it("404 when the session doesn't exist", async () => {
    grant(sb({ session: null }));
    expect((await post(VALID)).status).toBe(404);
  });

  it("404 when the (new) worker doesn't exist", async () => {
    grant(sb({ workersById: {} }));
    expect((await post(VALID)).status).toBe(404);
  });

  it("409 when the worker's type doesn't use sessions", async () => {
    grant(sb({ workersById: { u1: { ...HOURLY_WORKER, payroll_worker_type: "monthly_payslip" } } }));
    expect((await post(VALID)).status).toBe(409);
  });

  it("409s a session inside a locked payroll period", async () => {
    grant(sb({ periods: [{ ...OPEN_PERIOD, status: "locked" }] }));
    expect((await post(VALID)).status).toBe(409);
  });

  it("400s when the edit would overlap a sibling session for the same worker", async () => {
    grant(sb({ siblings: [{ id: "other", clock_in: "2026-05-15T07:00:00", clock_out: "2026-05-15T09:00:00" }] }));
    expect((await post(VALID)).status).toBe(400);
  });

  it("skips the overlap check for a session_only worker", async () => {
    grant(
      sb({
        workersById: { u1: { ...HOURLY_WORKER, payroll_worker_type: "session_only" } },
        siblings: [{ id: "other", clock_in: "2026-05-15T07:00:00", clock_out: "2026-05-15T09:00:00" }],
      })
    );
    expect((await post(VALID)).status).toBe(200);
  });
});

describe("POST /api/payroll/sessions/update — labor cost resolution", () => {
  it("an explicit labor_cost always wins, even when recalculate_labor_cost is also requested", async () => {
    const database = sb();
    grant(database);
    await post({ ...VALID, labor_cost: 999, recalculate_labor_cost: true });
    expect(database.calls.update[0]).toMatchObject({ labor_cost: 999 });
    // Explicit cost given -> the live-recalculate branch is skipped entirely.
    expect(recalculateUserSessionCostsFromRules).not.toHaveBeenCalled();
  });

  it("recalculate_labor_cost with no explicit cost nulls it on persist, then recalculates live and audits the REFRESHED row", async () => {
    const database = sb();
    grant(database);
    const res = await post({ ...VALID, recalculate_labor_cost: true });
    expect(res.status).toBe(200);
    expect(database.calls.update[0]).toMatchObject({ labor_cost: null });
    expect(recalculateUserSessionCostsFromRules).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      expect.objectContaining({ fromDate: "2026-05-15" })
    );
    expect(regenerateEditablePayslipsForUsers).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "update", recordId: "sess-1" }));
  });

  it("preserves the session's existing labor_cost when neither an explicit value nor a recalc is requested", async () => {
    const database = sb();
    grant(database);
    await post(VALID);
    expect(database.calls.update[0]).toMatchObject({ labor_cost: 400 }); // SESSION's own existing value
  });
});

describe("POST /api/payroll/sessions/update — reassigning to a different worker", () => {
  const OTHER_WORKER = { id: "u2", payroll_worker_type: "monthly_payslip", pay_tracking_mode: "payslip" };

  it("resolves whether to regenerate the PREVIOUS worker's payslips from their OWN type, not the new worker's", async () => {
    const database = sb({ workersById: { u1: OTHER_WORKER, u2: HOURLY_WORKER } });
    grant(database);
    // Moving the session from u1 (its current owner per SESSION fixture) to u2.
    const res = await post({ ...VALID, user_id: "u2" });
    expect(res.status).toBe(200);
    // New worker (u2) is hourly_payslip -> generates payslips. Previous owner
    // (u1, per SESSION.user_id) is looked up separately as OTHER_WORKER
    // (monthly_payslip) -> ALSO generates payslips. Both should regenerate.
    expect(regenerateEditablePayslipsForUsers).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining(["u1", "u2"]));
  });
});
