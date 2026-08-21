import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for POST /api/orders/create — input validation (which runs
// BEFORE the auth gate, by design), the create_sales_order RPC, payment inserts,
// prepayment enforcement, and Hebrew error mapping.

const { requireRouteAccess, tryAutoIssueInvoiceForOrder, tryAutoIssueReceiptForPayment } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  tryAutoIssueInvoiceForOrder: vi.fn(async () => ({ ok: true, skipped: true, reason: null, morningDocumentId: null })),
  tryAutoIssueReceiptForPayment: vi.fn(async () => ({ ok: true, skipped: true, reason: null, morningDocumentId: null })),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/morning/service", () => ({ tryAutoIssueInvoiceForOrder, tryAutoIssueReceiptForPayment }));

import { POST } from "@/app/api/orders/create/route";

type Resp = { data: unknown; error: unknown };

function makeSupabase(responses: Record<string, Resp>, rpc: Resp = { data: null, error: null }, calls: string[] = []) {
  const from = (table: string) => {
    const resp = responses[table] ?? { data: null, error: null };
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "insert", "update", "delete", "eq", "not", "gte", "in", "order", "limit"]) {
      builder[m] = (..._args: unknown[]) => {
        calls.push(`${table}.${m}`);
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve(resp);
    builder.then = (onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(resp).then(onF, onR);
    return builder;
  };
  return { from, rpc: () => Promise.resolve(rpc) };
}

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/orders/create", { method: "POST", body: JSON.stringify(body) }));
}

const VALID = {
  customer_id: "c1",
  order_date: "2024-05-01",
  items: [{ product_id: "prod1", quantity_ordered: 1, unit_price: 100 }],
};

beforeEach(() => {
  requireRouteAccess.mockReset();
  tryAutoIssueInvoiceForOrder.mockClear();
});

describe("POST /api/orders/create — validation runs before auth", () => {
  it("400 on missing required fields, without ever calling the auth gate", async () => {
    const res = await post({ customer_id: "", order_date: "", items: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/לפחות פריט/);
    expect(requireRouteAccess).not.toHaveBeenCalled();
  });

  it("400 on an invalid order item", async () => {
    const res = await post({ ...VALID, items: [{ product_id: "", quantity_ordered: 1, unit_price: 100 }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/הפריטים|פריט.*אינו תקין/);
  });

  it("400 on an invalid payment payload", async () => {
    const res = await post({ ...VALID, payments: [{ amount_total: 0, payment_date: "2024-05-01", payment_method: "cash" }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/התשלומים|תשלום.*אינו תקין/);
  });
});

describe("POST /api/orders/create — auth gate (after validation)", () => {
  it("returns the gate's response when access is denied for a valid body", async () => {
    requireRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await post(VALID);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/orders/create — RPC & persistence", () => {
  it("creates the order via the RPC and returns its id + derived status", async () => {
    grant(makeSupabase({ customers: { data: { requires_prepayment: false }, error: null } }, { data: "order-1", error: null }));
    const res = await post(VALID);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.order_id).toBe("order-1");
    expect(json.payment_status).toBe("unpaid"); // nothing paid yet
  });

  it("still creates the order for a prepayment customer with a balance (flagged red, not blocked)", async () => {
    // Pay-ahead customers are no longer blocked at create — the order goes through
    // and is flagged red in the lists until paid. See lib/orders/prepayment.
    grant(makeSupabase({ customers: { data: { requires_prepayment: true }, error: null } }, { data: "order-1", error: null }));
    const res = await post(VALID);
    expect(res.status).toBe(200);
    expect((await res.json()).order_id).toBe("order-1");
  });

  it("surfaces a helpful hint when the RPC function is missing", async () => {
    grant(
      makeSupabase(
        { customers: { data: { requires_prepayment: false }, error: null } },
        { data: null, error: { message: "could not find function create_sales_order" } }
      )
    );
    const res = await post(VALID);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/create_sales_order_rpc\.sql/);
  });

  it("passes requested_delivery_date through to the RPC when provided", async () => {
    const rpcCalls: { name: string; params: Record<string, unknown> }[] = [];
    const supabase = makeSupabase(
      { customers: { data: { requires_prepayment: false }, error: null } },
      { data: "order-1", error: null }
    );
    const originalRpc = supabase.rpc;
    supabase.rpc = ((name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return originalRpc();
    }) as typeof supabase.rpc;
    grant(supabase);
    const res = await post({ ...VALID, requested_delivery_date: "2024-06-01" });
    expect(res.status).toBe(200);
    expect(rpcCalls[0].params.p_requested_delivery_date).toBe("2024-06-01");
  });

  it("passes null for requested_delivery_date when the customer didn't ask for a date", async () => {
    const rpcCalls: { name: string; params: Record<string, unknown> }[] = [];
    const supabase = makeSupabase(
      { customers: { data: { requires_prepayment: false }, error: null } },
      { data: "order-1", error: null }
    );
    const originalRpc = supabase.rpc;
    supabase.rpc = ((name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return originalRpc();
    }) as typeof supabase.rpc;
    grant(supabase);
    const res = await post(VALID);
    expect(res.status).toBe(200);
    expect(rpcCalls[0].params.p_requested_delivery_date).toBeNull();
  });

  it("maps a payment-insert DB error to Hebrew", async () => {
    grant(
      makeSupabase(
        {
          customers: { data: { requires_prepayment: false }, error: null },
          payments: { data: null, error: { message: "duplicate key value violates unique constraint" } },
        },
        { data: "order-1", error: null }
      )
    );
    const res = await post({
      ...VALID,
      payments: [{ amount_total: 50, payment_date: "2024-05-01", payment_method: "cash" }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("הערך כבר קיים במערכת.");
  });
});
