import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for /api/payroll/worker-payments — GET/POST/PATCH/DELETE.
// The highest-risk logic here is the debt-allocation validation: an
// allocation must match the worker's payment-allocation source type
// (session for session_only workers, payslip for everyone else), the total
// allocated can't exceed the payment amount, and no single allocation can
// exceed what's actually still owed on that debt item — including, on an
// EDIT, correctly adding this payment's OWN existing allocation back to the
// "available" amount (otherwise editing a payment would immediately look
// over-allocated against its own prior allocation).

const { requireRouteAccess, logAuditEvent } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ logAuditEvent }));

import { DELETE, GET, PATCH, POST } from "@/app/api/payroll/worker-payments/route";

type Resp = { data: unknown; error: unknown };

const SESSION_ONLY_WORKER = { id: "u1", payroll_worker_type: "session_only", pay_tracking_mode: "session" };
const PAYSLIP_WORKER = { id: "u1", payroll_worker_type: "hourly_payslip", pay_tracking_mode: "session" };

function sb(opts: {
  worker?: unknown;
  existingPayment?: unknown;
  existingAllocations?: unknown[];
  debtItems?: unknown[];
  paymentWriteResp?: Resp;
  allocationInsertResp?: Resp;
} = {}) {
  const calls = {
    paymentInsert: [] as unknown[],
    paymentUpdate: [] as unknown[],
    paymentDelete: 0,
    allocationDelete: 0,
    allocationInsert: [] as unknown[],
  };

  const from = (table: string) => {
    let op: "select" | "insert" | "update" | "delete" = "select";
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.in = () => builder;
    builder.insert = (values: unknown) => {
      op = "insert";
      if (table === "worker_payments") calls.paymentInsert.push(values);
      if (table === "worker_payment_allocations") calls.allocationInsert.push(values);
      return builder;
    };
    builder.update = (values: unknown) => {
      op = "update";
      if (table === "worker_payments") calls.paymentUpdate.push(values);
      return builder;
    };
    builder.delete = () => {
      op = "delete";
      if (table === "worker_payments") calls.paymentDelete += 1;
      if (table === "worker_payment_allocations") calls.allocationDelete += 1;
      return builder;
    };
    const resolve = (): Resp => {
      if (table === "users") return { data: "worker" in opts ? opts.worker : PAYSLIP_WORKER, error: null };
      if (table === "worker_debt_items_view") return { data: opts.debtItems ?? [], error: null };
      if (table === "worker_payments") {
        if (op === "insert" || op === "update") {
          return opts.paymentWriteResp ?? { data: { id: "wp-1", user_id: "u1" }, error: null };
        }
        if (op === "delete") return { data: null, error: null };
        return { data: "existingPayment" in opts ? opts.existingPayment : { id: "wp-1", user_id: "u1" }, error: null };
      }
      if (table === "worker_payment_allocations") {
        if (op === "insert") return opts.allocationInsertResp ?? { data: [{ id: "alloc-1" }], error: null };
        if (op === "delete") return { data: null, error: null };
        return { data: opts.existingAllocations ?? [], error: null };
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

function req(url: string, method: string, body?: unknown) {
  return new Request(url, { method, body: body !== undefined ? JSON.stringify(body) : undefined });
}

const VALID_CREATE = { user_id: "u1", payment_date: "2026-05-15", amount: 500 };

beforeEach(() => {
  requireRouteAccess.mockReset();
  logAuditEvent.mockReset();
});

describe("POST /api/payroll/worker-payments — auth & validation", () => {
  it("returns the gate's response when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await POST(req("http://test", "POST", VALID_CREATE));
    expect(res.status).toBe(403);
  });

  it("400 on missing user_id/payment_date, or a non-positive amount", async () => {
    grant(sb());
    expect((await POST(req("http://test", "POST", { ...VALID_CREATE, user_id: "" }))).status).toBe(400);
    expect((await POST(req("http://test", "POST", { ...VALID_CREATE, payment_date: "" }))).status).toBe(400);
    expect((await POST(req("http://test", "POST", { ...VALID_CREATE, amount: 0 }))).status).toBe(400);
  });

  it("404 when the worker doesn't exist", async () => {
    grant(sb({ worker: null }));
    expect((await POST(req("http://test", "POST", VALID_CREATE))).status).toBe(404);
  });
});

describe("POST /api/payroll/worker-payments — allocation source-type guard", () => {
  it("400s a payslip allocation for a session_only worker", async () => {
    grant(sb({ worker: SESSION_ONLY_WORKER }));
    const res = await POST(
      req("http://test", "POST", { ...VALID_CREATE, allocations: [{ source_type: "payslip", source_id: "ps-1", amount: 100 }] })
    );
    expect(res.status).toBe(400);
  });

  it("400s a session allocation for a payslip-tracked worker", async () => {
    grant(sb({ worker: PAYSLIP_WORKER, debtItems: [{ source_type: "session", source_id: "s-1", user_id: "u1", owed_amount: 100 }] }));
    const res = await POST(
      req("http://test", "POST", { ...VALID_CREATE, allocations: [{ source_type: "session", source_id: "s-1", amount: 100 }] })
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/payroll/worker-payments — allocation total & debt validation", () => {
  it("400s when the allocation total exceeds the payment amount", async () => {
    grant(
      sb({
        worker: PAYSLIP_WORKER,
        debtItems: [{ source_type: "payslip", source_id: "ps-1", user_id: "u1", owed_amount: 1000 }],
      })
    );
    const res = await POST(
      req("http://test", "POST", { ...VALID_CREATE, amount: 500, allocations: [{ source_type: "payslip", source_id: "ps-1", amount: 600 }] })
    );
    expect(res.status).toBe(400);
  });

  it("400s an allocation against a source id that isn't actually owed by this worker", async () => {
    grant(sb({ worker: PAYSLIP_WORKER, debtItems: [] })); // the requested source id isn't in the debt view at all
    const res = await POST(
      req("http://test", "POST", { ...VALID_CREATE, allocations: [{ source_type: "payslip", source_id: "ps-unknown", amount: 100 }] })
    );
    expect(res.status).toBe(400);
  });

  it("400s an allocation that exceeds the item's remaining owed amount", async () => {
    grant(
      sb({
        worker: PAYSLIP_WORKER,
        debtItems: [{ source_type: "payslip", source_id: "ps-1", user_id: "u1", owed_amount: 100 }],
      })
    );
    const res = await POST(
      req("http://test", "POST", { ...VALID_CREATE, amount: 500, allocations: [{ source_type: "payslip", source_id: "ps-1", amount: 150 }] })
    );
    expect(res.status).toBe(400);
  });

  it("allows an allocation that exactly matches the remaining owed amount", async () => {
    grant(
      sb({
        worker: PAYSLIP_WORKER,
        debtItems: [{ source_type: "payslip", source_id: "ps-1", user_id: "u1", owed_amount: 500 }],
      })
    );
    const res = await POST(
      req("http://test", "POST", { ...VALID_CREATE, amount: 500, allocations: [{ source_type: "payslip", source_id: "ps-1", amount: 500 }] })
    );
    expect(res.status).toBe(200);
  });

  it("allows an unallocated payment (an advance) with no allocations at all", async () => {
    grant(sb({ worker: PAYSLIP_WORKER }));
    const res = await POST(req("http://test", "POST", VALID_CREATE));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/payroll/worker-payments — persistence, rollback & audit", () => {
  it("persists the payment and its allocations, then audits a 'create'", async () => {
    const database = sb({
      worker: PAYSLIP_WORKER,
      debtItems: [{ source_type: "payslip", source_id: "ps-1", user_id: "u1", owed_amount: 500 }],
    });
    grant(database);
    const res = await POST(
      req("http://test", "POST", { ...VALID_CREATE, amount: 500, allocations: [{ source_type: "payslip", source_id: "ps-1", amount: 500 }] })
    );
    expect(res.status).toBe(200);
    expect(database.calls.paymentInsert[0]).toMatchObject({ user_id: "u1", amount: 500, recorded_by: "prof-1" });
    expect(database.calls.allocationInsert[0]).toEqual([
      expect.objectContaining({ worker_payment_id: "wp-1", source_type: "payslip", payslip_id: "ps-1", amount: 500 }),
    ]);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "create", recordId: "wp-1" }));
  });

  it("rolls back (deletes) the just-created payment if inserting its allocations fails", async () => {
    const database = sb({
      worker: PAYSLIP_WORKER,
      debtItems: [{ source_type: "payslip", source_id: "ps-1", user_id: "u1", owed_amount: 500 }],
      allocationInsertResp: { data: null, error: { message: "boom" } },
    });
    grant(database);
    const res = await POST(
      req("http://test", "POST", { ...VALID_CREATE, amount: 500, allocations: [{ source_type: "payslip", source_id: "ps-1", amount: 500 }] })
    );
    expect(res.status).toBe(400);
    expect(database.calls.paymentDelete).toBe(1);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/payroll/worker-payments — update", () => {
  it("404 when the payment doesn't exist", async () => {
    grant(sb({ worker: PAYSLIP_WORKER, existingPayment: null }));
    const res = await PATCH(req("http://test", "PATCH", { payment_id: "wp-1", ...VALID_CREATE }));
    expect(res.status).toBe(404);
  });

  it("400 when the payment doesn't belong to the given worker", async () => {
    grant(sb({ worker: PAYSLIP_WORKER, existingPayment: { id: "wp-1", user_id: "u-other" } }));
    const res = await PATCH(req("http://test", "PATCH", { payment_id: "wp-1", ...VALID_CREATE }));
    expect(res.status).toBe(400);
  });

  it("adds this payment's OWN existing allocation back to the available amount, so re-saving the same allocation doesn't look over-allocated", async () => {
    const database = sb({
      worker: PAYSLIP_WORKER,
      existingAllocations: [{ id: "alloc-old", source_type: "payslip", attendance_session_id: null, payslip_id: "ps-1", amount: 500 }],
      // owed_amount already reflects the existing allocation being "spent" -> only 0 nominally left...
      debtItems: [{ source_type: "payslip", source_id: "ps-1", user_id: "u1", owed_amount: 0 }],
    });
    grant(database);
    // ...but re-submitting the SAME 500 allocation on this same payment must be allowed.
    const res = await PATCH(
      req("http://test", "PATCH", {
        payment_id: "wp-1",
        ...VALID_CREATE,
        amount: 500,
        allocations: [{ source_type: "payslip", source_id: "ps-1", amount: 500 }],
      })
    );
    expect(res.status).toBe(200);
  });

  it("replaces allocations (deletes existing, inserts the new set) and audits an 'update'", async () => {
    const database = sb({
      worker: PAYSLIP_WORKER,
      existingAllocations: [{ id: "alloc-old", source_type: "payslip", attendance_session_id: null, payslip_id: "ps-1", amount: 200 }],
      debtItems: [{ source_type: "payslip", source_id: "ps-1", user_id: "u1", owed_amount: 300 }],
    });
    grant(database);
    const res = await PATCH(
      req("http://test", "PATCH", {
        payment_id: "wp-1",
        ...VALID_CREATE,
        amount: 500,
        allocations: [{ source_type: "payslip", source_id: "ps-1", amount: 500 }],
      })
    );
    expect(res.status).toBe(200);
    expect(database.calls.allocationDelete).toBe(1);
    expect(database.calls.allocationInsert).toHaveLength(1);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "update" }));
  });
});

describe("DELETE /api/payroll/worker-payments", () => {
  it("400 on missing payment_id", async () => {
    grant(sb());
    expect((await DELETE(req("http://test", "DELETE", {}))).status).toBe(400);
  });

  it("404 when the payment doesn't exist", async () => {
    grant(sb({ existingPayment: null }));
    expect((await DELETE(req("http://test", "DELETE", { payment_id: "wp-1" }))).status).toBe(404);
  });

  it("400 when a user_id is given but doesn't match the payment's own", async () => {
    grant(sb({ existingPayment: { id: "wp-1", user_id: "u-other" } }));
    const res = await DELETE(req("http://test", "DELETE", { payment_id: "wp-1", user_id: "u1" }));
    expect(res.status).toBe(400);
  });

  it("deletes and audits on success", async () => {
    const database = sb({ existingPayment: { id: "wp-1", user_id: "u1" } });
    grant(database);
    const res = await DELETE(req("http://test", "DELETE", { payment_id: "wp-1", user_id: "u1" }));
    expect(res.status).toBe(200);
    expect(database.calls.paymentDelete).toBe(1);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "delete", recordId: "wp-1" }));
  });
});

describe("GET /api/payroll/worker-payments", () => {
  it("400 on missing payment_id", async () => {
    grant(sb());
    const res = await GET(req("http://test/api/payroll/worker-payments", "GET"));
    expect(res.status).toBe(400);
  });

  it("404 when the payment doesn't exist", async () => {
    grant(sb({ existingPayment: null }));
    const res = await GET(req("http://test/api/payroll/worker-payments?payment_id=wp-1", "GET"));
    expect(res.status).toBe(404);
  });

  it("returns the payment, its allocations and the worker's name", async () => {
    const database = sb({
      existingPayment: { id: "wp-1", user_id: "u1" },
      existingAllocations: [{ id: "a1", source_type: "payslip", attendance_session_id: null, payslip_id: "ps-1", amount: 500 }],
      worker: { full_name: "דוד כהן" },
    });
    grant(database);
    const res = await GET(req("http://test/api/payroll/worker-payments?payment_id=wp-1", "GET"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.payment).toMatchObject({ id: "wp-1" });
    expect(json.allocations).toHaveLength(1);
    expect(json.workerName).toBe("דוד כהן");
  });
});
