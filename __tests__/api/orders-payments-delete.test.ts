import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for POST /api/orders/payments/delete — the admin/office-
// only gate, the order-ownership guard, and the payment_status recompute
// after deletion. Same multi-shape "payments" table pattern as the update
// route's test file (id-lookup, delete, order_id list) — see its comment.

const { requireRouteAccess, logAuditEvent } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ logAuditEvent }));

import { POST } from "@/app/api/orders/payments/delete/route";

type Resp = { data: unknown; error: unknown };

function sb(opts: { existing?: unknown; paymentRows?: unknown[]; order?: unknown; deleteError?: unknown } = {}) {
  const existing = "existing" in opts ? opts.existing : { id: "pay-1", order_id: "ord-1" };
  const paymentRows = opts.paymentRows ?? [];
  const order = opts.order ?? { total_amount: 1000 };
  const calls = { delete: { payments: 0 }, update: { orders: [] as unknown[] } };

  const from = (table: string) => {
    if (table === "payments") {
      let filterCol: string | null = null;
      let deleted = false;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = (col: string) => {
        filterCol = filterCol ?? col;
        return builder;
      };
      builder.delete = () => {
        deleted = true;
        calls.delete.payments += 1;
        return builder;
      };
      const resolve = (): Resp => {
        if (deleted) return { data: null, error: opts.deleteError ?? null };
        if (filterCol === "id") return { data: existing, error: null };
        return { data: paymentRows, error: null };
      };
      builder.maybeSingle = () => Promise.resolve(resolve());
      builder.then = (onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(onF, onR);
      return builder;
    }

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
  return POST(new Request("http://test/api/orders/payments/delete", { method: "POST", body: JSON.stringify(body) }));
}

const VALID = { id: "pay-1", order_id: "ord-1" };

beforeEach(() => {
  requireRouteAccess.mockReset();
  logAuditEvent.mockReset();
});

describe("POST /api/orders/payments/delete — auth gate", () => {
  it("requests the admin/office-only allowedRoles gate", async () => {
    grant(sb());
    await post(VALID);
    expect(requireRouteAccess).toHaveBeenCalledWith({ allowedRoles: ["admin", "office"] });
  });

  it("returns the gate's response when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await post(VALID);
    expect(res.status).toBe(403);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("POST /api/orders/payments/delete — validation", () => {
  it("400 on missing id or order_id, before the auth gate runs", async () => {
    const res = await post({ id: "pay-1" });
    expect(res.status).toBe(400);
    expect(requireRouteAccess).not.toHaveBeenCalled();
  });
});

describe("POST /api/orders/payments/delete — order ownership guard", () => {
  it("404 when the payment doesn't exist", async () => {
    grant(sb({ existing: null }));
    expect((await post(VALID)).status).toBe(404);
  });

  it("404 when the payment belongs to a different order", async () => {
    grant(sb({ existing: { id: "pay-1", order_id: "ord-other" } }));
    const res = await post(VALID);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/orders/payments/delete — persistence, audit & status recompute", () => {
  it("deletes, logs a 'delete' audit event, and recomputes the order's payment_status", async () => {
    const database = sb({ order: { total_amount: 1000 }, paymentRows: [] });
    grant(database);
    const res = await post(VALID);
    expect(res.status).toBe(200);
    expect(database.calls.delete.payments).toBe(1);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "payments", action: "delete", recordId: "pay-1", changedBy: "prof-1" })
    );
    const json = await res.json();
    expect(json.payment_status).toBe("unpaid"); // no payments left
    expect(database.calls.update.orders[0]).toMatchObject({ payment_status: "unpaid" });
  });

  it("maps a DB error on the delete itself to a Hebrew message", async () => {
    grant(sb({ deleteError: { message: "boom" } }));
    const res = await post(VALID);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });
});
