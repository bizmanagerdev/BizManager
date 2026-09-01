import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for POST /api/orders/payments/update. Two things make this
// distinct from the general /api/payments/update: it's gated to admin/office
// ONLY (a field/delivery worker must never edit a money row — per the
// route's own comment, stricter than the general payments update gate), and
// every payment must belong to the order_id given alongside its id.
//
// The route queries "payments" twice with different .eq() filters (an id
// lookup, then an order_id list for the status recompute) plus one .update()
// — three distinct shapes on one table, more than the shared
// supabase-query-builder mock's single read/write split models, so this
// file builds its own small mock that resolves by which column was filtered.

const { requireRouteAccess, logAuditEvent } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ logAuditEvent }));

import { POST } from "@/app/api/orders/payments/update/route";

type Resp = { data: unknown; error: unknown };

function sb(opts: {
  existing?: unknown;
  paymentRows?: unknown[];
  order?: unknown;
  updateResp?: Resp;
} = {}) {
  const existing = "existing" in opts ? opts.existing : { id: "pay-1", order_id: "ord-1", project_id: null, property_id: null, payment_status: "cleared" };
  const paymentRows = opts.paymentRows ?? [{ amount_total: 400, payment_status: "cleared", due_date: null }];
  const order = opts.order ?? { total_amount: 1000 };
  const updateResp: Resp = opts.updateResp ?? { data: { id: "pay-1" }, error: null };
  const calls = { update: { payments: [] as unknown[], orders: [] as unknown[] } };

  const from = (table: string) => {
    if (table === "payments") {
      let filterCol: string | null = null;
      let wrote = false;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = (col: string) => {
        filterCol = filterCol ?? col; // remember the FIRST filter column of this chain
        return builder;
      };
      builder.update = (values: unknown) => {
        wrote = true;
        calls.update.payments.push(values);
        return builder;
      };
      const resolve = (): Resp => {
        if (wrote) return updateResp;
        if (filterCol === "id") return { data: existing, error: null };
        return { data: paymentRows, error: null }; // filtered by order_id -> the aggregate list
      };
      builder.maybeSingle = () => Promise.resolve(resolve());
      builder.then = (onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(onF, onR);
      return builder;
    }

    // orders: one read (total_amount) then one write (payment_status).
    let wrote = false;
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.update = (values: unknown) => {
      wrote = true;
      calls.update.orders.push(values);
      return builder;
    };
    const resolve = (): Resp => (wrote ? { data: null, error: null } : { data: order, error: null });
    builder.maybeSingle = () => Promise.resolve(resolve());
    builder.then = (onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(onF, onR);
    return builder;
  };

  return { from, calls };
}

function grant(supabase: unknown, role = "admin") {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/orders/payments/update", { method: "POST", body: JSON.stringify(body) }));
}

const VALID = {
  id: "pay-1",
  order_id: "ord-1",
  amount_total: 400,
  payment_date: "2026-05-01",
  payment_method: "bank_transfer",
};

beforeEach(() => {
  requireRouteAccess.mockReset();
  logAuditEvent.mockReset();
});

describe("POST /api/orders/payments/update — auth gate", () => {
  it("requests the admin/office-only allowedRoles gate, stricter than the general payments update", async () => {
    grant(sb());
    await post(VALID);
    expect(requireRouteAccess).toHaveBeenCalledWith({ allowedRoles: ["admin", "office"] });
  });

  it("returns the gate's response when access is denied (e.g. a worker)", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await post(VALID);
    expect(res.status).toBe(403);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("POST /api/orders/payments/update — validation", () => {
  it("400 on missing id or order_id — validated BEFORE the auth gate even runs", async () => {
    const res = await post({ ...VALID, order_id: undefined });
    expect(res.status).toBe(400);
    expect(requireRouteAccess).not.toHaveBeenCalled();
  });

  it("400 on a non-finite or zero amount", async () => {
    grant(sb());
    expect((await post({ ...VALID, amount_total: 0 })).status).toBe(400);
  });

  it("400 on missing payment_date or payment_method", async () => {
    grant(sb());
    expect((await post({ ...VALID, payment_method: "" })).status).toBe(400);
  });

  it("400 on a check with no due_date", async () => {
    grant(sb());
    const res = await post({ ...VALID, payment_method: "check", due_date: null });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/orders/payments/update — order ownership guard", () => {
  it("404 when the payment doesn't exist", async () => {
    grant(sb({ existing: null }));
    expect((await post(VALID)).status).toBe(404);
  });

  it("404 when the payment belongs to a different order", async () => {
    grant(sb({ existing: { id: "pay-1", order_id: "ord-other", project_id: null, property_id: null, payment_status: "cleared" } }));
    const res = await post(VALID);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/orders/payments/update — field preservation & persistence", () => {
  it("preserves the existing (cleared) collection status", async () => {
    const database = sb();
    grant(database);
    await post(VALID);
    expect(database.calls.update.payments[0]).toMatchObject({ payment_status: "cleared" });
  });

  it("logs an 'update' audit event on success", async () => {
    grant(sb());
    const res = await post(VALID);
    expect(res.status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "payments", action: "update", recordId: "pay-1", changedBy: "prof-1" })
    );
  });

  it("recomputes and persists the order's payment_status after the edit", async () => {
    const database = sb({
      paymentRows: [{ amount_total: 400, payment_status: "cleared", due_date: null }],
      order: { total_amount: 400 },
    });
    grant(database);
    const res = await post(VALID);
    expect((await res.json()).payment_status).toBe("paid");
    expect(database.calls.update.orders[0]).toMatchObject({ payment_status: "paid" });
  });
});
