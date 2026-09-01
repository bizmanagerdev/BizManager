import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for POST/PATCH/DELETE /api/financial/transfers — account-to-
// account transfers. Per the route's own comment: deliberately NOT an
// expense+income pair, profit-neutral and cash-neutral, touching only the
// accounts ledger — so the invariants worth locking down are the role gate
// (admin/office only, stricter than the general auth gate), the same-account
// guard, and that DELETE removes the transfer as one row (both legs at once,
// so the two account balances can never drift apart).

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));

import { DELETE, PATCH, POST } from "@/app/api/financial/transfers/route";

type Resp = { data: unknown; error: unknown };

function makeSupabase(resp: Resp = { data: { id: "tr-1" }, error: null }) {
  const calls: { insert?: unknown; update?: unknown; deleteEqId?: unknown } = {};
  const from = () => {
    const builder: Record<string, unknown> = {};
    builder.insert = (values: unknown) => {
      calls.insert = values;
      return builder;
    };
    builder.update = (values: unknown) => {
      calls.update = values;
      return builder;
    };
    builder.delete = () => builder;
    builder.eq = (_col: string, value: unknown) => {
      calls.deleteEqId = value;
      return builder;
    };
    builder.select = () => builder;
    builder.single = () => Promise.resolve(resp);
    builder.then = (onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(resp).then(onF, onR);
    return builder;
  };
  return { from, calls };
}

function grant(role: string, supabase: unknown = makeSupabase()) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role } },
  });
}

const VALID = {
  from_account_id: "acc-a",
  to_account_id: "acc-b",
  amount: 500,
  transfer_date: "2026-05-01",
};

beforeEach(() => requireRouteAccess.mockReset());

describe("POST /api/financial/transfers", () => {
  it("returns the gate's response when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify(VALID) }));
    expect(res.status).toBe(403);
  });

  it.each(["worker", "worker_no_access"])("403s for a role stricter than the general auth gate (%s)", async (role) => {
    grant(role);
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify(VALID) }));
    expect(res.status).toBe(403);
  });

  it("allows admin and office", async () => {
    for (const role of ["admin", "office"]) {
      grant(role);
      const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify(VALID) }));
      expect(res.status).toBe(200);
    }
  });

  it("400s on a missing source/destination account, or when they're the same", async () => {
    grant("admin");
    expect((await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ ...VALID, from_account_id: "" }) }))).status).toBe(400);
    grant("admin");
    expect((await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ ...VALID, to_account_id: "" }) }))).status).toBe(400);
    grant("admin");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ ...VALID, to_account_id: "acc-a" }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("לא ניתן להעביר לאותו חשבון.");
  });

  it("400s on a non-positive or non-numeric amount", async () => {
    grant("admin");
    expect((await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ ...VALID, amount: 0 }) }))).status).toBe(400);
    grant("admin");
    expect((await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ ...VALID, amount: -5 }) }))).status).toBe(400);
  });

  it("400s on a missing/malformed date", async () => {
    grant("admin");
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ ...VALID, transfer_date: "01/05/2026" }) }));
    expect(res.status).toBe(400);
  });

  it("persists the transfer with the creator's profile id and returns its id", async () => {
    const sb = makeSupabase({ data: { id: "tr-1" }, error: null });
    grant("admin", sb);
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify(VALID) }));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("tr-1");
    expect(sb.calls.insert).toMatchObject({ ...VALID, created_by: "prof-1" });
  });

  it("maps a DB error to a Hebrew fallback message", async () => {
    grant("admin", makeSupabase({ data: null, error: { message: "boom" } }));
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify(VALID) }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBeTruthy();
  });
});

describe("PATCH /api/financial/transfers", () => {
  it("403s for a role without transfer access", async () => {
    grant("worker");
    const res = await PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify({ id: "tr-1", ...VALID }) }));
    expect(res.status).toBe(403);
  });

  it("400s when the id is missing", async () => {
    grant("admin");
    const res = await PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify(VALID) }));
    expect(res.status).toBe(400);
  });

  it("requires both accounts even on edit, and rejects them being equal", async () => {
    grant("admin");
    const res = await PATCH(
      new Request("http://test", { method: "PATCH", body: JSON.stringify({ id: "tr-1", ...VALID, to_account_id: "acc-a" }) })
    );
    expect(res.status).toBe(400);
  });

  it("persists the update", async () => {
    const sb = makeSupabase({ data: null, error: null });
    grant("admin", sb);
    const res = await PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify({ id: "tr-1", ...VALID, amount: 750 }) }));
    expect(res.status).toBe(200);
    expect(sb.calls.update).toMatchObject({ amount: 750, from_account_id: "acc-a", to_account_id: "acc-b" });
  });
});

describe("DELETE /api/financial/transfers", () => {
  it("403s for a role without transfer access", async () => {
    grant("worker");
    const res = await DELETE(new Request("http://test?id=tr-1", { method: "DELETE" }));
    expect(res.status).toBe(403);
  });

  it("400s when the id query param is missing", async () => {
    grant("admin");
    const res = await DELETE(new Request("http://test", { method: "DELETE" }));
    expect(res.status).toBe(400);
  });

  it("deletes the single row by id — both legs go together, so balances can't drift apart", async () => {
    const sb = makeSupabase({ data: null, error: null });
    grant("admin", sb);
    const res = await DELETE(new Request("http://test?id=tr-1", { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(sb.calls.deleteEqId).toBe("tr-1");
  });
});
