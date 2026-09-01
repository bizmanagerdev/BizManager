import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for POST /api/payroll/sessions/split — the most complex of
// the payroll/sessions family. Splits one closed session into 2+ parts,
// reusing the ORIGINAL session row as part 1 and inserting new rows for the
// rest. Mode is decided by worker type, not the client: session_only
// (contractor) workers split by an explicit cost per part ("money" mode);
// everyone else splits by minutes, recalculated from salary rules after
// ("time" mode) — a client can't submit a labor_cost for an hourly worker
// or a minutes count for a contractor.
//
// The highest-value things checked here: TIME mode silently OVERRIDES
// whatever minutes the client sent for the LAST part with the actual
// remainder (so the parts always sum to exactly the original shift length,
// never drift by a rounding error the client introduced); the atomic
// mark-paid path for a money-mode split, including its 3-step compensating
// rollback (delete allocations, delete payment, undo the split) if the
// payment fails partway through; and that a plain insert failure (no
// payment involved) restores the original session to its exact pre-split
// state rather than leaving it half-updated.

const { requireRouteAccess, logAuditEvent, recalculateUserSessionCostsFromRules } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  logAuditEvent: vi.fn(),
  recalculateUserSessionCostsFromRules: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ logAuditEvent }));
vi.mock("@/lib/payroll-center", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payroll-center")>();
  return { ...actual, recalculateUserSessionCostsFromRules };
});

import { POST } from "@/app/api/payroll/sessions/split/route";

type Resp = { data: unknown; error: unknown };

const SESSION = {
  id: "sess-1",
  user_id: "u1",
  clock_in: "2026-05-15T08:00:00.000Z",
  clock_out: "2026-05-15T16:00:00.000Z", // 480 minutes
  worked_minutes: 480,
  notes: "משמרת",
  business_domain: "general_business",
  project_id: null,
  property_id: null,
  labor_cost: 400,
  is_billable_to_customer: false,
  bill_to_customer_amount: null,
  billing_status: "not_billable",
};
const OPEN_PERIOD = { id: "per-1", period_month: "2026-05", start_date: "2026-05-01", end_date: "2026-05-31", status: "open" };
const HOURLY_WORKER = { id: "u1", payroll_worker_type: "hourly_payslip", pay_tracking_mode: "session" };
const CONTRACTOR_WORKER = { id: "u1", payroll_worker_type: "session_only", pay_tracking_mode: "session" };

function sb(opts: {
  session?: unknown;
  periods?: unknown[];
  worker?: unknown;
  project?: unknown;
  property?: unknown;
  insertRowsResp?: Resp;
  paymentInsertResp?: Resp;
  allocationInsertResp?: Resp;
} = {}) {
  const calls = {
    sessionUpdates: [] as unknown[],
    sessionInserts: [] as Array<Array<Record<string, unknown>>>,
    sessionDeletes: [] as unknown[],
    paymentInsert: [] as unknown[],
    paymentDelete: 0,
    allocationInsert: [] as unknown[],
    allocationDelete: 0,
  };

  const from = (table: string) => {
    let op: "select" | "insert" | "update" | "delete" = "select";
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.range = () => builder;
    builder.in = (_col: string, values: unknown) => {
      if (table === "attendance_sessions" && op === "delete") calls.sessionDeletes.push(values);
      return builder;
    };
    builder.insert = (values: unknown) => {
      op = "insert";
      if (table === "attendance_sessions") calls.sessionInserts.push(values as Array<Record<string, unknown>>);
      if (table === "worker_payments") calls.paymentInsert.push(values);
      if (table === "worker_payment_allocations") calls.allocationInsert.push(values);
      return builder;
    };
    builder.update = (values: unknown) => {
      op = "update";
      if (table === "attendance_sessions") calls.sessionUpdates.push(values);
      return builder;
    };
    builder.delete = () => {
      op = "delete";
      if (table === "worker_payments") calls.paymentDelete += 1;
      if (table === "worker_payment_allocations") calls.allocationDelete += 1;
      return builder;
    };
    const resolve = (): Resp => {
      if (table === "attendance_sessions") {
        if (op === "insert") {
          if (opts.insertRowsResp) return opts.insertRowsResp;
          const inserted = (calls.sessionInserts[calls.sessionInserts.length - 1] ?? []) as Array<Record<string, unknown>>;
          return { data: inserted.map((row, i) => ({ id: `sess-${i + 2}`, labor_cost: row.labor_cost ?? null })), error: null };
        }
        if (op === "update" || op === "delete") return { data: null, error: null };
        return { data: "session" in opts ? opts.session : SESSION, error: null };
      }
      if (table === "payroll_periods") return { data: opts.periods ?? [OPEN_PERIOD], error: null };
      if (table === "users") return { data: "worker" in opts ? opts.worker : HOURLY_WORKER, error: null };
      if (table === "projects") return { data: "project" in opts ? opts.project : { id: "proj-1" }, error: null };
      if (table === "properties") return { data: "property" in opts ? opts.property : { id: "prop-1" }, error: null };
      if (table === "worker_payments") {
        if (op === "insert") return opts.paymentInsertResp ?? { data: { id: "wp-1" }, error: null };
        return { data: null, error: null };
      }
      if (table === "worker_payment_allocations") {
        if (op === "insert") return opts.allocationInsertResp ?? { data: null, error: null };
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };
    builder.maybeSingle = () => Promise.resolve(resolve());
    builder.then = (onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(onF, onR);
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
  return POST(new Request("http://test/api/payroll/sessions/split", { method: "POST", body: JSON.stringify(body) }));
}

const TWO_TIME_PARTS = { session_id: "sess-1", parts: [{ minutes: 200, business_domain: "general_business" }, { minutes: 280, business_domain: "general_business" }] };
const TWO_MONEY_PARTS = { session_id: "sess-1", parts: [{ amount: 150, business_domain: "general_business" }, { amount: 250, business_domain: "general_business" }] };

beforeEach(() => {
  requireRouteAccess.mockReset();
  logAuditEvent.mockReset();
  recalculateUserSessionCostsFromRules.mockClear();
});

describe("POST /api/payroll/sessions/split — auth gate", () => {
  it("requests the admin/office gate", async () => {
    grant(sb());
    await post(TWO_TIME_PARTS);
    expect(requireRouteAccess).toHaveBeenCalledWith({ allowedRoles: ["admin", "office"] });
  });

  it("returns the gate's response when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    expect((await post(TWO_TIME_PARTS)).status).toBe(403);
  });
});

describe("POST /api/payroll/sessions/split — validation & guards", () => {
  it("400 on missing session_id, or fewer than 2 parts", async () => {
    grant(sb());
    expect((await post({ ...TWO_TIME_PARTS, session_id: "" })).status).toBe(400);
    expect((await post({ session_id: "sess-1", parts: [{ minutes: 480, business_domain: "general_business" }] })).status).toBe(400);
  });

  it("404 when the session is still open (no clock_out)", async () => {
    grant(sb({ session: { ...SESSION, clock_out: null } }));
    expect((await post(TWO_TIME_PARTS)).status).toBe(404);
  });

  it("409s a session inside a locked payroll period", async () => {
    grant(sb({ periods: [{ ...OPEN_PERIOD, status: "locked" }] }));
    expect((await post(TWO_TIME_PARTS)).status).toBe(409);
  });

  it("409 when the worker's type doesn't use sessions at all", async () => {
    grant(sb({ worker: { ...HOURLY_WORKER, payroll_worker_type: "monthly_payslip" } }));
    expect((await post(TWO_TIME_PARTS)).status).toBe(409);
  });

  it("400s a session too short to split (<=1 minute)", async () => {
    grant(sb({ session: { ...SESSION, clock_in: "2026-05-15T08:00:00.000Z", clock_out: "2026-05-15T08:00:30.000Z" } }));
    expect((await post(TWO_TIME_PARTS)).status).toBe(400);
  });

  it("400s when there are more parts than minutes in the shift", async () => {
    const tinySession = { ...SESSION, clock_in: "2026-05-15T08:00:00.000Z", clock_out: "2026-05-15T08:00:03.000Z" }; // 3 min
    grant(sb({ session: tinySession }));
    const res = await post({
      session_id: "sess-1",
      parts: [
        { minutes: 1, business_domain: "general_business" },
        { minutes: 1, business_domain: "general_business" },
        { minutes: 1, business_domain: "general_business" },
        { minutes: 1, business_domain: "general_business" },
      ],
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/payroll/sessions/split — mode is decided by worker type", () => {
  it("uses TIME mode (minutes) for an hourly/payslip worker, ignoring any client-sent amount", async () => {
    const database = sb({ worker: HOURLY_WORKER });
    grant(database);
    const res = await post(TWO_TIME_PARTS);
    expect(res.status).toBe(200);
    // labor_cost is null in time mode -> filled in later by the rules recalculation.
    expect(database.calls.sessionUpdates[0]).toMatchObject({ labor_cost: null });
    expect(recalculateUserSessionCostsFromRules).toHaveBeenCalled();
  });

  it("uses MONEY mode (explicit cost) for a session_only (contractor) worker, and never recalculates from rules", async () => {
    const database = sb({ worker: CONTRACTOR_WORKER });
    grant(database);
    const res = await post(TWO_MONEY_PARTS);
    expect(res.status).toBe(200);
    expect(database.calls.sessionUpdates[0]).toMatchObject({ labor_cost: 150 });
    expect(recalculateUserSessionCostsFromRules).not.toHaveBeenCalled();
  });

  it("400s a money-mode part with no valid amount", async () => {
    grant(sb({ worker: CONTRACTOR_WORKER }));
    const res = await post({
      session_id: "sess-1",
      parts: [{ business_domain: "general_business" }, { amount: 100, business_domain: "general_business" }],
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/payroll/sessions/split — TIME mode minute allocation", () => {
  it("overrides whatever minutes the client requested for the LAST part with the actual remainder", async () => {
    const database = sb({ worker: HOURLY_WORKER });
    grant(database);
    // 480-minute shift; client asks for 100 + 999999 (nonsense for the last part).
    const res = await post({
      session_id: "sess-1",
      parts: [
        { minutes: 100, business_domain: "general_business" },
        { minutes: 999999, business_domain: "general_business" },
      ],
    });
    expect(res.status).toBe(200);
    expect(database.calls.sessionUpdates[0]).toMatchObject({ worked_minutes: 100 });
    // Inserted part 2 gets the true remainder (480 - 100 = 380), not 999999.
    expect(database.calls.sessionInserts[0][0]).toMatchObject({ worked_minutes: 380 });
  });

  it("400s a non-last part whose minutes would leave no time for the remaining parts", async () => {
    grant(sb({ worker: HOURLY_WORKER }));
    const res = await post({
      session_id: "sess-1",
      parts: [
        { minutes: 479, business_domain: "general_business" }, // leaves only 1 minute for 2 more parts
        { minutes: 1, business_domain: "general_business" },
        { minutes: 1, business_domain: "general_business" },
      ],
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/payroll/sessions/split — per-part domain/link validation", () => {
  it("400s a part with an invalid business_domain, or a domain missing its required project/property", async () => {
    grant(sb());
    expect(
      (await post({ session_id: "sess-1", parts: [{ minutes: 200, business_domain: "nope" }, { minutes: 280, business_domain: "general_business" }] })).status
    ).toBe(400);
    expect(
      (await post({ session_id: "sess-1", parts: [{ minutes: 200, business_domain: "logistics_projects" }, { minutes: 280, business_domain: "general_business" }] })).status
    ).toBe(400);
  });

  it("404s when a part's linked project/property doesn't exist", async () => {
    grant(sb({ project: null }));
    const res = await post({
      session_id: "sess-1",
      parts: [
        { minutes: 200, business_domain: "logistics_projects", project_id: "proj-1" },
        { minutes: 280, business_domain: "general_business" },
      ],
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/payroll/sessions/split — persistence: reuses the original row as part 1, chains the rest", () => {
  it("updates the original session in place as part 1, and inserts sequentially-chained rows for the rest", async () => {
    const database = sb({ worker: HOURLY_WORKER });
    grant(database);
    const res = await post(TWO_TIME_PARTS);
    expect(res.status).toBe(200);
    expect(database.calls.sessionUpdates[0]).toMatchObject({
      clock_out: "2026-05-15T11:20:00.000Z", // 08:00 + 200min
      worked_minutes: 200,
    });
    expect(database.calls.sessionInserts[0][0]).toMatchObject({
      user_id: "u1",
      clock_in: "2026-05-15T11:20:00.000Z", // picks up exactly where part 1 left off
      clock_out: "2026-05-15T16:00:00.000Z",
      worked_minutes: 280,
      notes: "משמרת", // carried over from the original session
    });
  });

  it("rolls the original session back to its exact pre-split state if inserting the remaining parts fails", async () => {
    const database = sb({ worker: HOURLY_WORKER, insertRowsResp: { data: null, error: { message: "boom" } } });
    grant(database);
    const res = await post(TWO_TIME_PARTS);
    expect(res.status).toBe(400);
    // Second update call is the restore, undoing the first (part-1-commit) update.
    expect(database.calls.sessionUpdates[1]).toMatchObject({
      clock_out: SESSION.clock_out,
      worked_minutes: SESSION.worked_minutes,
      labor_cost: SESSION.labor_cost,
    });
  });
});

describe("POST /api/payroll/sessions/split — atomic mark-paid (money mode)", () => {
  it("waterfall-allocates the payment across parts, inserts the payment + allocations, and audits everything", async () => {
    const database = sb({ worker: CONTRACTOR_WORKER });
    grant(database);
    const res = await post({ ...TWO_MONEY_PARTS, payment: { mark_paid: true } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.payment_id).toBe("wp-1");
    expect(database.calls.paymentInsert[0]).toMatchObject({ user_id: "u1", amount: 400 }); // 150 + 250
    // Waterfall: part 1 (sess-1, cost 150) filled first, then part 2 (sess-2 — the inserted
    // row's mocked id from insertRowsResp's default) up to the remainder.
    expect(database.calls.allocationInsert[0]).toEqual([
      expect.objectContaining({ attendance_session_id: "sess-1", amount: 150 }),
      expect.objectContaining({ attendance_session_id: "sess-2", amount: 250 }),
    ]);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ tableName: "worker_payments", action: "create", recordId: "wp-1" }));
  });

  it("fully rolls back the split (deletes the inserted parts, restores the original session) when the payment insert fails", async () => {
    const database = sb({
      worker: CONTRACTOR_WORKER,
      paymentInsertResp: { data: null, error: { message: "boom" } },
    });
    grant(database);
    const res = await post({ ...TWO_MONEY_PARTS, payment: { mark_paid: true } });
    expect(res.status).toBe(400);
    expect(database.calls.sessionDeletes[0]).toEqual(["sess-2"]); // the inserted part is removed
    // The LAST update call restores the original session's pre-split state.
    const lastUpdate = database.calls.sessionUpdates[database.calls.sessionUpdates.length - 1];
    expect(lastUpdate).toMatchObject({ clock_out: SESSION.clock_out, labor_cost: SESSION.labor_cost });
  });

  it("does not attempt a payment at all when mark_paid isn't requested", async () => {
    const database = sb({ worker: CONTRACTOR_WORKER });
    grant(database);
    const res = await post(TWO_MONEY_PARTS);
    expect(res.status).toBe(200);
    expect(database.calls.paymentInsert).toHaveLength(0);
  });
});
