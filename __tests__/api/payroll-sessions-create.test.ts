import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { makeSupabase, type MockResp } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/payroll/sessions/create. Scoped to the
// validation cascade (business domain, worker existence/active/role/type,
// project/property existence, clock_in < clock_out) and the overlap guard —
// the salary-agreement-driven cost recalculation + payslip regeneration
// branch is a bigger, more fixture-heavy path better exercised as its own
// follow-up.

const { requireRouteAccess, logAuditEvent, regenerateEditablePayslipsForUsers } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  logAuditEvent: vi.fn(),
  regenerateEditablePayslipsForUsers: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ logAuditEvent }));
vi.mock("@/lib/idempotency", () => ({
  withIdempotency: (_req: unknown, _sb: unknown, _uid: unknown, _ep: unknown, handler: () => Promise<unknown>) => handler(),
}));
vi.mock("@/lib/payroll-center", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payroll-center")>();
  return { ...actual, regenerateEditablePayslipsForUsers };
});

import { POST } from "@/app/api/payroll/sessions/create/route";

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
    salary_agreements: { data: [], error: null },
  });
}

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/payroll/sessions/create", { method: "POST", body: JSON.stringify(body) }));
}

const VALID = {
  business_domain: "general_business",
  user_id: "u1",
  clock_in: "2026-05-15T08:00:00",
  clock_out: "2026-05-15T16:00:00",
};

beforeEach(() => {
  requireRouteAccess.mockReset();
  logAuditEvent.mockReset();
  regenerateEditablePayslipsForUsers.mockClear();
});

describe("POST /api/payroll/sessions/create — auth gate", () => {
  it("requests the admin/office-only gate", async () => {
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

describe("POST /api/payroll/sessions/create — validation", () => {
  beforeEach(() => grant(sb()));

  it("400 on a missing/invalid business_domain", async () => {
    expect((await post({ ...VALID, business_domain: "not-real" })).status).toBe(400);
  });

  it("400 on a missing user_id", async () => {
    expect((await post({ ...VALID, user_id: "" })).status).toBe(400);
  });

  it("400 on a missing clock_in or clock_out", async () => {
    expect((await post({ ...VALID, clock_out: "" })).status).toBe(400);
  });

  it("400 when clock_out is before/equal to clock_in", async () => {
    const res = await post({ ...VALID, clock_out: VALID.clock_in });
    expect(res.status).toBe(400);
  });

  it("400 for logistics_projects with no project_id", async () => {
    const res = await post({ ...VALID, business_domain: "logistics_projects" });
    expect(res.status).toBe(400);
  });

  it("400 for property_management with no property_id", async () => {
    const res = await post({ ...VALID, business_domain: "property_management" });
    expect(res.status).toBe(400);
  });

  it("400 for a billable session with no valid bill_to_customer_amount", async () => {
    const res = await post({ ...VALID, is_billable_to_customer: true, bill_to_customer_amount: 0 });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/payroll/sessions/create — worker eligibility", () => {
  it("404 when the selected worker doesn't exist", async () => {
    grant(sb({ worker: null }));
    expect((await post(VALID)).status).toBe(404);
  });

  it("400 for an inactive worker", async () => {
    grant(sb({ worker: { ...WORKER, active: false } }));
    expect((await post(VALID)).status).toBe(400);
  });

  it("400 for a role that isn't worker/worker_no_access (e.g. office)", async () => {
    grant(sb({ worker: { ...WORKER, role: "office" } }));
    expect((await post(VALID)).status).toBe(400);
  });

  it("409 for a worker type that doesn't track sessions (monthly_payslip, i.e. fixed monthly salary)", async () => {
    grant(sb({ worker: { ...WORKER, payroll_worker_type: "monthly_payslip" } }));
    const res = await post(VALID);
    expect(res.status).toBe(409);
  });
});

describe("POST /api/payroll/sessions/create — linked source existence", () => {
  it("404 when the linked project doesn't exist", async () => {
    grant(sb({ project: null }));
    const res = await post({ ...VALID, business_domain: "logistics_projects", project_id: "proj-1" });
    expect(res.status).toBe(404);
  });

  it("404 when the linked property doesn't exist", async () => {
    grant(sb({ property: null }));
    const res = await post({ ...VALID, business_domain: "property_management", property_id: "prop-1" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/payroll/sessions/create — overlap guard", () => {
  it("400s when the new session overlaps an existing one for the same worker", async () => {
    grant(sb({ existingSessions: [{ id: "other", clock_in: "2026-05-15T07:00:00", clock_out: "2026-05-15T09:00:00" }] }));
    const res = await post(VALID); // 08:00-16:00 overlaps 07:00-09:00
    expect(res.status).toBe(400);
  });

  it("allows a back-to-back (non-overlapping) session", async () => {
    grant(sb({ existingSessions: [{ id: "other", clock_in: "2026-05-15T00:00:00", clock_out: "2026-05-15T08:00:00" }] }));
    const res = await post(VALID); // starts exactly when the other ends
    expect(res.status).toBe(200);
  });

  it("skips the overlap check specifically for session_only (contractor) workers, even though they DO allow sessions", async () => {
    grant(
      sb({
        worker: { ...WORKER, payroll_worker_type: "session_only" },
        existingSessions: [{ id: "other", clock_in: "2026-05-15T07:00:00", clock_out: "2026-05-15T09:00:00" }],
      })
    );
    const res = await post(VALID);
    expect(res.status).toBe(200); // would be 400 (overlap) for any other trackable worker type
  });
});

describe("POST /api/payroll/sessions/create — persistence", () => {
  it("persists the session with the computed worked_minutes and business-domain-locked source", async () => {
    const database = sb();
    grant(database);
    const res = await post({ ...VALID, labor_cost: 400 });
    expect(res.status).toBe(200);
    expect(database.calls.insert.attendance_sessions[0]).toMatchObject({
      user_id: "u1",
      worked_minutes: 480, // 08:00 -> 16:00
      labor_cost: 400,
      project_id: null,
      property_id: null,
    });
  });

  it("regenerates payslips for a payslip-generating worker type, then audits", async () => {
    const database = sb();
    grant(database);
    const res = await post({ ...VALID, labor_cost: 400 });
    expect(res.status).toBe(200);
    expect(regenerateEditablePayslipsForUsers).toHaveBeenCalledWith(expect.anything(), ["u1"]);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "attendance_sessions", action: "create", recordId: "sess-1", changedBy: "prof-1" })
    );
  });
});
