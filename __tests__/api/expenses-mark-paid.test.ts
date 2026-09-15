import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/expenses/mark-paid — the one-tap "סמן כשולם"
// confirmation. It only ever flips the row to paid with method/account/date;
// the optional `amount` is the real figure for a row generated from a
// variable-amount (סכום משתנה) template, which until then carries the estimate.

const { requireRouteAccess, logAuditEvent } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ logAuditEvent }));

import { POST } from "@/app/api/expenses/mark-paid/route";

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/expenses/mark-paid", { method: "POST", body: JSON.stringify(body) }));
}

function sb() {
  return makeSupabase({
    expenses: { data: { id: "exp-1", payment_status: "paid" }, error: null },
  });
}

beforeEach(() => {
  requireRouteAccess.mockReset();
  logAuditEvent.mockReset();
});

describe("POST /api/expenses/mark-paid", () => {
  it("returns the gate's response when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await post({ id: "exp-1" });
    expect(res.status).toBe(403);
  });

  it("400 without an id", async () => {
    grant(sb());
    const res = await post({});
    expect(res.status).toBe(400);
  });

  it("flips the row to paid with method, account and pay date — and leaves the amount alone", async () => {
    const supabase = sb();
    grant(supabase);
    const res = await post({ id: "exp-1", payment_method: "bank_transfer", account_id: "acc-1", paid_date: "2026-09-14" });
    expect(res.status).toBe(200);
    const [patch] = supabase.calls.update.expenses as Array<Record<string, unknown>>;
    expect(patch).toEqual({ payment_status: "paid", payment_method: "bank_transfer", account_id: "acc-1", paid_date: "2026-09-14" });
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("writes the real figure over the estimate when `amount` is given (variable-amount bill)", async () => {
    const supabase = sb();
    grant(supabase);
    const res = await post({ id: "exp-1", amount: 2340.5, account_id: "acc-1" });
    expect(res.status).toBe(200);
    const [patch] = supabase.calls.update.expenses as Array<Record<string, unknown>>;
    expect(patch).toMatchObject({ amount: 2340.5, paid_amount: 2340.5, payment_status: "paid" });
  });

  it("ignores a zero, negative or unparseable amount", async () => {
    for (const amount of [0, -5, "abc", "", null]) {
      const supabase = sb();
      grant(supabase);
      await post({ id: "exp-1", amount });
      const [patch] = supabase.calls.update.expenses as Array<Record<string, unknown>>;
      expect(patch).not.toHaveProperty("amount");
      expect(patch).not.toHaveProperty("paid_amount");
    }
  });

  it("rejects an unknown payment method rather than storing it", async () => {
    const supabase = sb();
    grant(supabase);
    await post({ id: "exp-1", payment_method: "bitcoin" });
    const [patch] = supabase.calls.update.expenses as Array<Record<string, unknown>>;
    expect(patch.payment_method).toBeNull();
  });
});
