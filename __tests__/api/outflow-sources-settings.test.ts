import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { makeSupabase } from "@/__tests__/mocks/supabase-query-builder";

// Contract tests for POST /api/outflow-sources/settings — the per-source
// planning row ("מקורות נוספים"): kind/key validation, the reminder range, and
// the exact row that gets upserted.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));

import { POST } from "@/app/api/outflow-sources/settings/route";

function grant(supabase: unknown) {
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
}

function post(body: unknown) {
  return POST(new Request("http://test/api/outflow-sources/settings", { method: "POST", body: JSON.stringify(body) }));
}

function sb() {
  return makeSupabase({
    outflow_source_settings: { data: { source_kind: "card", source_key: "ויזה", reminder_work_days_before: 2, account_id: null }, error: null },
  });
}

beforeEach(() => requireRouteAccess.mockReset());

describe("POST /api/outflow-sources/settings", () => {
  it("returns the gate's response when access is denied", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await post({ source_kind: "card", source_key: "ויזה" });
    expect(res.status).toBe(403);
  });

  it("400 on an unknown kind or a missing key", async () => {
    grant(sb());
    expect((await post({ source_kind: "rent", source_key: "x" })).status).toBe(400);
    expect((await post({ source_kind: "card", source_key: "" })).status).toBe(400);
  });

  it("400 when the reminder is out of 0..30, or the account is not an id", async () => {
    grant(sb());
    expect((await post({ source_kind: "card", source_key: "ויזה", reminder_work_days_before: 31 })).status).toBe(400);
    expect((await post({ source_kind: "card", source_key: "ויזה", reminder_work_days_before: -1 })).status).toBe(400);
    expect((await post({ source_kind: "card", source_key: "ויזה", account_id: "not-a-uuid" })).status).toBe(400);
  });

  it("upserts one row per (kind, key) with the reminder and account", async () => {
    const supabase = sb();
    grant(supabase);
    const res = await post({
      source_kind: "loan",
      source_key: "L1",
      reminder_work_days_before: "2",
      account_id: "0be92d74-cae2-48cf-8066-a1e69478d8ee",
    });
    expect(res.status).toBe(200);
    const [row] = supabase.calls.upsert.outflow_source_settings as Array<Record<string, unknown>>;
    expect(row).toMatchObject({
      source_kind: "loan",
      source_key: "L1",
      reminder_work_days_before: 2,
      account_id: "0be92d74-cae2-48cf-8066-a1e69478d8ee",
      is_active: true,
    });
  });

  it("stores null (use the default) when no reminder is sent, and null account when cleared", async () => {
    const supabase = sb();
    grant(supabase);
    await post({ source_kind: "card", source_key: "ויזה", account_id: "", is_active: false });
    const [row] = supabase.calls.upsert.outflow_source_settings as Array<Record<string, unknown>>;
    expect(row).toMatchObject({ reminder_work_days_before: null, account_id: null, is_active: false });
  });
});
