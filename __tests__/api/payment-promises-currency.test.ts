import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// A payment promise in US$ / C$ (2026-10-25): its amount in its currency, its
// shekels at the newest Bank of Israel rate up to the promised date — what the
// cash forecast counts.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/idempotency", () => ({
  withIdempotency: (_req: unknown, _sb: unknown, _uid: unknown, _ep: unknown, handler: () => Promise<unknown>) => handler(),
}));

import { POST as create } from "@/app/api/payment-promises/create/route";
import { POST as update } from "@/app/api/payment-promises/update/route";

function sb(rate: unknown) {
  return {
    ...makeSupabase({ payment_promises: { data: [{ id: "pr-1" }], error: null } }),
    rpc: vi.fn(async () => ({ data: rate, error: null })),
  };
}

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}

const post = (handler: (req: Request) => Promise<Response>, body: unknown) =>
  handler(new Request("http://test", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => requireRouteAccess.mockReset());

describe("payment promises in US$ / C$", () => {
  it("$1,000 promised for 1/11: saved as its shekels, its dollars beside them", async () => {
    const database = sb(3.112);
    grant(database);
    const res = await post(create, { customer_id: "c1", amount: 1000, currency: "USD", promised_date: "2026-11-01" });
    expect(res.status).toBe(200);
    expect(database.rpc).toHaveBeenCalledWith("fx_rate_on", { p_currency: "USD", p_date: "2026-11-01" });
    expect(database.calls.insert.payment_promises[0]).toMatchObject({
      amount: 3112,
      currency: "USD",
      foreign_amount: 1000,
      fx_rate: 3.112,
    });
  });

  it("in shekels as before; no rate at all: refused", async () => {
    const shekels = sb(3.112);
    grant(shekels);
    await post(create, { customer_id: "c1", amount: 500, promised_date: "2026-11-01" });
    expect(shekels.calls.insert.payment_promises[0]).toMatchObject({ amount: 500 });
    expect(shekels.calls.insert.payment_promises[0]).not.toHaveProperty("currency");

    const none = sb(null);
    grant(none);
    const res = await post(create, { customer_id: "c1", amount: 500, currency: "CAD", promised_date: "2026-11-01" });
    expect(res.status).toBe(400);
    expect(none.calls.insert.payment_promises ?? []).toHaveLength(0);
  });

  it("an edit with its currency is priced; a status change touches no money", async () => {
    const priced = sb(2.2);
    grant(priced);
    await post(update, { id: "pr-1", amount: 100, currency: "CAD", promised_date: "2026-11-15" });
    expect(priced.calls.update.payment_promises[0]).toMatchObject({ amount: 220, currency: "CAD", foreign_amount: 100 });

    const status = sb(2.2);
    grant(status);
    await post(update, { id: "pr-1", status: "kept" });
    expect(status.calls.update.payment_promises[0]).not.toHaveProperty("amount");
    expect(status.rpc).not.toHaveBeenCalled();
  });
});
