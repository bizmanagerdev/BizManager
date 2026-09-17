import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/payments/confirm-settlement — confirming that a
// credit-card clearing deposit landed (or undoing it). A deposit is its
// account + its settlement date.

const { requireRouteAccess, logAuditEvent } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  logAuditEvent: vi.fn(),
}));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/audit", () => ({ logAuditEvent }));

import { POST } from "@/app/api/payments/confirm-settlement/route";

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}
const post = (body: unknown) =>
  POST(new Request("http://test/api/payments/confirm-settlement", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  requireRouteAccess.mockReset();
  logAuditEvent.mockReset();
  logAuditEvent.mockResolvedValue(undefined);
});

describe("POST /api/payments/confirm-settlement", () => {
  it("confirms a deposit, recording who and when", async () => {
    const sb = makeSupabase({ card_settlement_confirmations: { data: null, error: null } });
    grant(sb);
    const res = await post({ account_id: "acc-1", settlement_date: "2026-09-10" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, confirmed: true });
    const [row] = sb.calls.upsert.card_settlement_confirmations as Array<Record<string, unknown>>;
    expect(row).toMatchObject({ account_id: "acc-1", settlement_date: "2026-09-10", confirmed_by: "prof-1" });
  });

  it("undoes a confirmation", async () => {
    const sb = makeSupabase({ card_settlement_confirmations: { data: null, error: null } });
    grant(sb);
    const res = await post({ account_id: "acc-1", settlement_date: "2026-09-10", confirmed: false });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, confirmed: false });
    expect(sb.calls.delete.card_settlement_confirmations).toBe(1);
    expect(sb.calls.upsert.card_settlement_confirmations).toBeUndefined();
  });

  it("refuses a deposit with no account — it has nowhere to land", async () => {
    const sb = makeSupabase({});
    grant(sb);
    const res = await post({ settlement_date: "2026-09-10" });
    expect(res.status).toBe(400);
    expect(sb.calls.upsert.card_settlement_confirmations).toBeUndefined();
  });

  it("refuses a malformed date", async () => {
    const sb = makeSupabase({});
    grant(sb);
    expect((await post({ account_id: "acc-1", settlement_date: "10/09/2026" })).status).toBe(400);
  });

  it("says plainly that the migration is missing, rather than a raw error", async () => {
    const sb = makeSupabase({
      card_settlement_confirmations: { data: null, error: { message: "relation \"card_settlement_confirmations\" does not exist" } },
    });
    grant(sb);
    const res = await post({ account_id: "acc-1", settlement_date: "2026-09-10" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain("מיגרציה");
  });
});
