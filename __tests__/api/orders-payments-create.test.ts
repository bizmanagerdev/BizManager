import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { makeSupabase, type MockResp } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/orders/payments/create — validation, the
// refund sign-flip (entry_type="refund" negates the amount and gets a
// special "run the migration" message on the specific not-yet-migrated DB
// constraint), the order's payment_status recompute (COLLECTED money only —
// a pending/uncleared payment must never mark an order as שולם), and the
// best-effort Morning auto-receipt call.

const { requireRouteAccess, tryAutoIssueReceiptForPayment } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  tryAutoIssueReceiptForPayment: vi.fn(async () => ({
    ok: true,
    skipped: true,
    reason: null as string | null,
    morningDocumentId: null as string | null,
  })),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/idempotency", () => ({
  withIdempotency: (_req: unknown, _sb: unknown, _uid: unknown, _ep: unknown, handler: () => Promise<unknown>) => handler(),
}));
vi.mock("@/lib/morning/service", () => ({ tryAutoIssueReceiptForPayment }));

import { POST } from "@/app/api/orders/payments/create/route";

function grant(supabase: unknown, role = "admin") {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/orders/payments/create", { method: "POST", body: JSON.stringify(body) }));
}

const VALID = {
  order_id: "ord-1",
  amount_total: 400,
  payment_date: "2026-05-01",
  payment_method: "bank_transfer",
};

const ORDER = { id: "ord-1", total_amount: 1000 };

function sb(opts: { order?: unknown; paymentRows?: unknown[]; insertResp?: MockResp } = {}) {
  const order = "order" in opts ? opts.order : ORDER;
  return makeSupabase({
    orders: { read: { data: order, error: null }, write: { data: null, error: null } },
    payments: {
      write: opts.insertResp ?? { data: { id: "pay-1" }, error: null },
      read: { data: opts.paymentRows ?? [{ amount_total: 400, payment_status: "cleared", due_date: null }], error: null },
    },
  });
}

beforeEach(() => {
  requireRouteAccess.mockReset();
  tryAutoIssueReceiptForPayment.mockClear();
});

describe("POST /api/orders/payments/create — auth gate", () => {
  it("returns the gate's response when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await post(VALID);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/orders/payments/create — validation", () => {
  beforeEach(() => grant(sb()));

  it("400 on missing order_id", async () => {
    expect((await post({ ...VALID, order_id: undefined })).status).toBe(400);
  });

  it("400 on missing/invalid amount, date or method", async () => {
    expect((await post({ ...VALID, amount_total: 0 })).status).toBe(400);
    expect((await post({ ...VALID, payment_date: null })).status).toBe(400);
    expect((await post({ ...VALID, payment_method: "" })).status).toBe(400);
  });

  it("400 on a check with no due_date", async () => {
    const res = await post({ ...VALID, payment_method: "check", due_date: null });
    expect(res.status).toBe(400);
  });

  it("404 when the order doesn't exist", async () => {
    grant(sb({ order: null }));
    const res = await post(VALID);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/orders/payments/create — refunds", () => {
  it("negates the amount for a refund entry", async () => {
    const database = sb();
    grant(database);
    await post({ ...VALID, entry_type: "refund" });
    expect(database.calls.insert.payments[0]).toMatchObject({ amount_total: -400 });
  });

  it("maps the not-yet-migrated refund constraint to a specific Hebrew message, only for refunds", async () => {
    const database = sb({
      insertResp: { data: null, error: { message: "violates check constraint payments_amount_total_check" } },
    });
    grant(database);
    const res = await post({ ...VALID, entry_type: "refund" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("allow_order_refunds_in_payments.sql");
  });

  it("passes the same constraint error through unmapped for a non-refund payment", async () => {
    const database = sb({
      insertResp: { data: null, error: { message: "violates check constraint payments_amount_total_check" } },
    });
    grant(database);
    const res = await post(VALID); // entry_type defaults to "payment"
    expect((await res.json()).error).toBe("violates check constraint payments_amount_total_check");
  });
});

describe("POST /api/orders/payments/create — order status recompute", () => {
  it("counts only collected (non-pending) money toward payment_status", async () => {
    const database = sb({
      order: { id: "ord-1", total_amount: 1000 },
      // 400 already collected + 600 still pending -> NOT fully paid.
      paymentRows: [
        { amount_total: 400, payment_status: "cleared", due_date: null },
        { amount_total: 600, payment_status: "pending", due_date: "2099-01-01" },
      ],
    });
    grant(database);
    const res = await post(VALID);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.payment_status).toBe("partial");
    expect(json.total_paid).toBe(400);
    expect(database.calls.update.orders[0]).toMatchObject({ payment_status: "partial" });
  });

  it("marks the order paid once collected money covers the total", async () => {
    const database = sb({
      order: { id: "ord-1", total_amount: 400 },
      paymentRows: [{ amount_total: 400, payment_status: "cleared", due_date: null }],
    });
    grant(database);
    const res = await post(VALID);
    expect((await res.json()).payment_status).toBe("paid");
  });
});

describe("POST /api/orders/payments/create — Morning auto-receipt", () => {
  it("calls tryAutoIssueReceiptForPayment with the new payment id and actor, and surfaces its outcome", async () => {
    tryAutoIssueReceiptForPayment.mockResolvedValueOnce({ ok: true, skipped: false, reason: null, morningDocumentId: "doc-1" });
    const database = sb({ insertResp: { data: { id: "pay-9" }, error: null } });
    grant(database);
    const res = await post(VALID);
    expect(tryAutoIssueReceiptForPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ paymentId: "pay-9", actor: expect.objectContaining({ profileId: "prof-1" }) })
    );
    expect((await res.json()).morning_auto_receipt).toMatchObject({ skipped: false, morning_document_id: "doc-1" });
  });
});
