import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/accounts/ledger-checks — ticking a line of an
// account's register as "נבדק מול הבנק" (or unticking it). A line is its
// account + its register key; the tick keeps the line's signed amount and date.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));

import { POST } from "@/app/api/accounts/ledger-checks/route";

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}
const post = (body: unknown) =>
  POST(new Request("http://test/api/accounts/ledger-checks", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  requireRouteAccess.mockReset();
});

describe("POST /api/accounts/ledger-checks", () => {
  it("is admin-only, like the חשבונות page", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await post({ account_id: "acc-1", entry_key: "p:1", amount: 5, date: "2026-09-10" })).status).toBe(403);
    expect(requireRouteAccess).toHaveBeenCalledWith({ allowedRoles: ["admin"] });
  });

  it("ticks a line, keeping its signed amount and date, and who ticked it", async () => {
    const sb = makeSupabase({ account_ledger_checks: { data: null, error: null } });
    grant(sb);
    const res = await post({ account_id: "acc-1", entry_key: "t:tr-9:out", amount: -1200.004, date: "2026-09-10" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, checked: true });
    const [row] = sb.calls.upsert.account_ledger_checks as Array<Record<string, unknown>>;
    expect(row).toMatchObject({
      account_id: "acc-1",
      entry_key: "t:tr-9:out",
      amount_at_check: -1200,
      date_at_check: "2026-09-10",
      checked_by: "prof-1",
    });
  });

  it("unticks a line", async () => {
    const sb = makeSupabase({ account_ledger_checks: { data: null, error: null } });
    grant(sb);
    const res = await post({ account_id: "acc-1", entry_key: "e:ex-1", checked: false });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, checked: false });
    expect(sb.calls.delete.account_ledger_checks).toBe(1);
    expect(sb.calls.upsert.account_ledger_checks).toBeUndefined();
  });

  it("refuses a tick with no account, an unknown line, a bad amount or a bad date", async () => {
    const sb = makeSupabase({});
    grant(sb);
    const ok = { account_id: "acc-1", entry_key: "p:1", amount: 5, date: "2026-09-10" };
    expect((await post({ ...ok, account_id: "" })).status).toBe(400);
    expect((await post({ ...ok, entry_key: "nonsense" })).status).toBe(400);
    expect((await post({ ...ok, amount: "5" })).status).toBe(400);
    expect((await post({ ...ok, date: "10/09/2026" })).status).toBe(400);
    expect(sb.calls.upsert.account_ledger_checks).toBeUndefined();
  });

  it("says plainly that the migration is missing, rather than a raw error", async () => {
    const sb = makeSupabase({
      account_ledger_checks: { data: null, error: { message: "relation \"account_ledger_checks\" does not exist" } },
    });
    grant(sb);
    const res = await post({ account_id: "acc-1", entry_key: "p:1", amount: 5, date: "2026-09-10" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toContain("מיגרציה");
  });
});
