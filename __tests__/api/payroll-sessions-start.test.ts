import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { makeSupabase, type MockResp } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/payroll/sessions/start — opening a new shift.
// The worker-eligibility cascade mirrors sessions/create (see that file's
// comment on the session_only-allows-sessions gotcha); the interesting
// DIFFERENCE here is the overlap rule: a brand-new session has no end time
// yet, so overlapsOpenSession() checks something subtly different from
// sessions/create's symmetric range overlap — see the tests below.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));

import { POST } from "@/app/api/payroll/sessions/start/route";

const WORKER = { id: "u1", role: "worker", active: true, payroll_worker_type: "hourly_payslip", pay_tracking_mode: "session" };

function sb(opts: {
  worker?: unknown;
  project?: unknown;
  property?: unknown;
  existingSessions?: unknown[];
  insertResp?: MockResp;
} = {}) {
  return makeSupabase({
    users: { data: "worker" in opts ? opts.worker : WORKER, error: null },
    projects: { data: "project" in opts ? opts.project : { id: "proj-1" }, error: null },
    properties: { data: "property" in opts ? opts.property : { id: "prop-1" }, error: null },
    attendance_sessions: {
      read: { data: opts.existingSessions ?? [], error: null },
      write: opts.insertResp ?? { data: { id: "sess-1" }, error: null },
    },
  });
}

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/payroll/sessions/start", { method: "POST", body: JSON.stringify(body) }));
}

const VALID = { user_id: "u1", business_domain: "general_business", clock_in: "2026-05-15T08:00:00" };

beforeEach(() => requireRouteAccess.mockReset());

describe("POST /api/payroll/sessions/start — auth gate", () => {
  it("requests the admin/office gate", async () => {
    grant(sb());
    await post(VALID);
    expect(requireRouteAccess).toHaveBeenCalledWith({ allowedRoles: ["admin", "office"] });
  });

  it("returns the gate's response when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await post(VALID);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/payroll/sessions/start — validation", () => {
  beforeEach(() => grant(sb()));

  it("400 on a missing user_id", async () => {
    expect((await post({ ...VALID, user_id: "" })).status).toBe(400);
  });

  it("400 for logistics_projects with no project_id, property_management with no property_id", async () => {
    expect((await post({ ...VALID, business_domain: "logistics_projects" })).status).toBe(400);
    expect((await post({ ...VALID, business_domain: "property_management" })).status).toBe(400);
  });

  it("400 on an invalid clock_in", async () => {
    const res = await post({ ...VALID, clock_in: "not-a-date" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/payroll/sessions/start — worker eligibility", () => {
  it("404 when the worker doesn't exist, 400 when inactive, 400 for a non-worker role, 409 for a non-session worker type", async () => {
    grant(sb({ worker: null }));
    expect((await post(VALID)).status).toBe(404);

    grant(sb({ worker: { ...WORKER, active: false } }));
    expect((await post(VALID)).status).toBe(400);

    grant(sb({ worker: { ...WORKER, role: "office" } }));
    expect((await post(VALID)).status).toBe(400);

    grant(sb({ worker: { ...WORKER, payroll_worker_type: "monthly_payslip" } }));
    expect((await post(VALID)).status).toBe(409);
  });
});

describe("POST /api/payroll/sessions/start — linked source existence", () => {
  it("404 when the linked project/property doesn't exist", async () => {
    grant(sb({ project: null }));
    expect((await post({ ...VALID, business_domain: "logistics_projects", project_id: "proj-1" })).status).toBe(404);

    grant(sb({ property: null }));
    expect((await post({ ...VALID, business_domain: "property_management", property_id: "prop-1" })).status).toBe(404);
  });
});

describe("POST /api/payroll/sessions/start — the open-session overlap rule", () => {
  it("blocks starting a new shift while ANY existing session for the worker is still open, regardless of the new clock_in time", async () => {
    // The existing open session started in the past — a brand new clock-in,
    // even far in the future, still conflicts because you can't be clocked
    // into two shifts at once.
    grant(sb({ existingSessions: [{ id: "other", clock_in: "2020-01-01T08:00:00", clock_out: null }] }));
    const res = await post(VALID);
    expect(res.status).toBe(400);
  });

  it("blocks backdating a new session's start into a period a past (already-closed) session covered", async () => {
    grant(
      sb({
        existingSessions: [{ id: "other", clock_in: "2026-05-15T06:00:00", clock_out: "2026-05-15T14:00:00" }],
      })
    );
    const res = await post({ ...VALID, clock_in: "2026-05-15T10:00:00" }); // falls inside the closed session's range
    expect(res.status).toBe(400);
  });

  it("allows starting a new session once every one of the worker's past sessions is already closed and behind it", async () => {
    grant(
      sb({
        existingSessions: [{ id: "other", clock_in: "2026-05-14T08:00:00", clock_out: "2026-05-14T16:00:00" }],
      })
    );
    const res = await post(VALID); // 2026-05-15, a full day after the prior session closed
    expect(res.status).toBe(200);
  });
});

describe("POST /api/payroll/sessions/start — persistence", () => {
  it("persists the new open session (no clock_out/worked_minutes yet) with the domain-locked source", async () => {
    const database = sb();
    grant(database);
    const res = await post(VALID);
    expect(res.status).toBe(200);
    expect(database.calls.insert.attendance_sessions[0]).toMatchObject({
      user_id: "u1",
      clock_in: VALID.clock_in,
      project_id: null,
      property_id: null,
    });
  });
});
