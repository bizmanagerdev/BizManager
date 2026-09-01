import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/recurring-expenses/delete — a small route,
// but it removes a TEMPLATE (not an expense row), gated to admin/office,
// with no cascading logic of its own — worth a quick check that the gate
// and the id validation are wired correctly.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));

import { POST } from "@/app/api/recurring-expenses/delete/route";

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/recurring-expenses/delete", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => requireRouteAccess.mockReset());

describe("POST /api/recurring-expenses/delete", () => {
  it("400 on missing id, before the auth gate even runs", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(requireRouteAccess).not.toHaveBeenCalled();
  });

  it("requests the admin/office-only gate", async () => {
    grant(makeSupabase({ recurring_expense_templates: { data: null, error: null } }));
    await post({ id: "tpl-1" });
    expect(requireRouteAccess).toHaveBeenCalledWith({ allowedRoles: ["admin", "office"] });
  });

  it("returns the gate's response when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await post({ id: "tpl-1" });
    expect(res.status).toBe(403);
  });

  it("deletes the template by id and returns ok", async () => {
    const database = makeSupabase({ recurring_expense_templates: { data: null, error: null } });
    grant(database);
    const res = await post({ id: "tpl-1" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(database.calls.delete.recurring_expense_templates).toBe(1);
  });

  it("maps a DB error to a Hebrew message", async () => {
    grant(makeSupabase({ recurring_expense_templates: { data: null, error: { message: "boom" } } }));
    const res = await post({ id: "tpl-1" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });
});
