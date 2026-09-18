import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for POST /api/orders/update — the save must be ATOMIC: the
// payment/refund rows go INTO the update_sales_order RPC (one transaction) and
// the route never inserts into `payments` on its own any more. Background:
// 2026-09-15, a worker's confirm closed the order and consumed stock, then the
// separate payments insert was rejected by RLS and the collected ₪680 was lost.

const { requireRouteAccess, tryAutoIssueInvoiceForOrder, tryAutoIssueReceiptForPayment } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  tryAutoIssueInvoiceForOrder: vi.fn(async () => ({ ok: true, skipped: true, reason: null, morningDocumentId: null })),
  tryAutoIssueReceiptForPayment: vi.fn(async () => ({ ok: true, skipped: true, reason: null, morningDocumentId: null })),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/morning/service", () => ({ tryAutoIssueInvoiceForOrder, tryAutoIssueReceiptForPayment }));
// `after()` needs a live request scope; run its callback inline so the
// Morning auto-issue assertions below can observe it.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => void fn() };
});

import { POST } from "@/app/api/orders/update/route";

type Resp = { data: unknown; error: unknown };
type RpcCall = { name: string; params: Record<string, unknown> };

function makeSupabase(
  responses: Record<string, Resp>,
  rpc: Resp,
  calls: string[] = [],
  rpcCalls: RpcCall[] = []
) {
  const from = (table: string) => {
    const resp = responses[table] ?? { data: null, error: null };
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "insert", "update", "delete", "eq", "in", "maybeSingle"]) {
      builder[m] = (..._args: unknown[]) => {
        calls.push(`${table}.${m}`);
        return builder;
      };
    }
    builder.then = (onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(resp).then(onF, onR);
    return builder;
  };
  return {
    from,
    rpc: (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return Promise.resolve(rpc);
    },
    storage: { from: () => ({ upload: vi.fn(), remove: vi.fn() }) },
  };
}

function grant(supabase: unknown, role = "admin") {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role, section_access: {} } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/orders/update", { method: "POST", body: JSON.stringify(body) }));
}

const RPC_OK: Resp = { data: { order_id: "order-1", payment_ids: ["pay-1"], refund_ids: [] }, error: null };
const NO_EXISTING_PAYMENTS: Record<string, Resp> = { payments: { data: [], error: null } };

const VALID = {
  order_id: "order-1",
  customer_id: "c1",
  order_date: "2024-05-01",
  status: "delivered",
  delivery_date: "2024-05-02",
  items: [{ product_id: "prod1", quantity_ordered: 2, quantity_delivered: 2, unit_price: 340 }],
};

const CASH_PAYMENT = { amount_total: 680, payment_date: "2024-05-02", payment_method: "cash", account_id: "acc-1" };

beforeEach(() => {
  requireRouteAccess.mockReset();
  tryAutoIssueInvoiceForOrder.mockClear();
  tryAutoIssueReceiptForPayment.mockClear();
});

describe("POST /api/orders/update — gates", () => {
  it("returns the gate's response when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await post(VALID);
    expect(res.status).toBe(403);
  });

  it("403s a worker without the deliveries section", async () => {
    grant(makeSupabase(NO_EXISTING_PAYMENTS, RPC_OK), "worker");
    const res = await post(VALID);
    expect(res.status).toBe(403);
  });

  it("400 on an invalid payment entry before touching the database", async () => {
    const calls: string[] = [];
    const rpcCalls: RpcCall[] = [];
    grant(makeSupabase(NO_EXISTING_PAYMENTS, RPC_OK, calls, rpcCalls));
    const res = await post({ ...VALID, payments: [{ ...CASH_PAYMENT, amount_total: 0 }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/התשלומים/);
    expect(rpcCalls).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});

describe("POST /api/orders/update — money rows ride inside the RPC transaction", () => {
  it("passes the built payment rows as p_payments and never inserts into payments itself", async () => {
    const calls: string[] = [];
    const rpcCalls: RpcCall[] = [];
    grant(makeSupabase(NO_EXISTING_PAYMENTS, RPC_OK, calls, rpcCalls));

    const res = await post({ ...VALID, payments: [CASH_PAYMENT] });
    expect(res.status).toBe(200);

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("update_sales_order");
    const rows = rpcCalls[0].params.p_payments as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amount_total: 680,
      net_amount: 680,
      payment_method: "cash",
      payment_status: "cleared",
      order_id: "order-1",
      business_domain: "sales",
      // public.users.id (profile.id), not the auth uid — payments.recorded_by
      // is an FK to public.users(id), which a worker's own auth uid never
      // matches (see app/api/orders/update/route.ts's own comment).
      recorded_by: "prof-1",
      account_id: "acc-1",
    });
    expect(rpcCalls[0].params.p_refunds).toEqual([]);

    // The old two-step path is gone: no direct write to payments.
    expect(calls).not.toContain("payments.insert");

    const json = await res.json();
    expect(json.order_id).toBe("order-1");
    expect(json.payment_ids).toEqual(["pay-1"]);
    expect(json.total_paid).toBe(680);
    expect(json.payment_status).toBe("paid");
  });

  it("sends refunds as negative rows in p_refunds", async () => {
    const rpcCalls: RpcCall[] = [];
    grant(makeSupabase(NO_EXISTING_PAYMENTS, RPC_OK, [], rpcCalls));

    const res = await post({
      ...VALID,
      payments: [{ ...CASH_PAYMENT, amount_total: 700 }],
      refunds: [{ amount_total: 20, payment_date: "2024-05-02", payment_method: "cash" }],
    });
    expect(res.status).toBe(200);
    const refunds = rpcCalls[0].params.p_refunds as Record<string, unknown>[];
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount_total).toBe(-20);
    expect(refunds[0].notes).toBe("Refund");
  });

  it("sends empty arrays when nothing was collected", async () => {
    const rpcCalls: RpcCall[] = [];
    grant(makeSupabase(NO_EXISTING_PAYMENTS, { data: { order_id: "order-1", payment_ids: [], refund_ids: [] }, error: null }, [], rpcCalls));
    const res = await post(VALID);
    expect(res.status).toBe(200);
    expect(rpcCalls[0].params.p_payments).toEqual([]);
    expect(rpcCalls[0].params.p_refunds).toEqual([]);
    expect((await res.json()).payment_ids).toEqual([]);
  });

  it("auto-issues a Morning receipt for every payment id the RPC returns", async () => {
    grant(
      makeSupabase(NO_EXISTING_PAYMENTS, {
        data: { order_id: "order-1", payment_ids: ["pay-1", "pay-2"], refund_ids: ["ref-1"] },
        error: null,
      })
    );
    const res = await post({ ...VALID, payments: [CASH_PAYMENT] });
    expect(res.status).toBe(200);
    expect(tryAutoIssueReceiptForPayment).toHaveBeenCalledTimes(2);
    const receiptIds = tryAutoIssueReceiptForPayment.mock.calls.map(
      (c) => ((c as unknown[])[1] as { paymentId: string }).paymentId
    );
    expect(receiptIds).toEqual(["pay-1", "pay-2"]);
  });
});

describe("POST /api/orders/update — RPC failure leaves nothing half-done", () => {
  it("maps an RLS rejection inside the RPC to the Hebrew permission error", async () => {
    grant(
      makeSupabase(NO_EXISTING_PAYMENTS, {
        data: null,
        error: { message: 'new row violates row-level security policy for table "payments"' },
      })
    );
    const res = await post({ ...VALID, payments: [CASH_PAYMENT] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("אין הרשאה לבצע את הפעולה.");
    expect(tryAutoIssueReceiptForPayment).not.toHaveBeenCalled();
  });

  it("points at the atomic migration when the RPC signature is missing", async () => {
    grant(
      makeSupabase(NO_EXISTING_PAYMENTS, {
        data: null,
        error: { message: "Could not find the function public.update_sales_order(p_branch_id, ...) in the schema cache" },
      })
    );
    const res = await post(VALID);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/20260915213319_atomic_order_update_payments\.sql/);
  });

  it("explains the legacy refund CHECK constraint", async () => {
    grant(
      makeSupabase(NO_EXISTING_PAYMENTS, {
        data: null,
        error: { message: 'new row for relation "payments" violates check constraint "payments_amount_total_check"' },
      })
    );
    const res = await post({
      ...VALID,
      payments: [{ ...CASH_PAYMENT, amount_total: 700 }],
      refunds: [{ amount_total: 20, payment_date: "2024-05-02", payment_method: "cash" }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/החזרים/);
  });
});
