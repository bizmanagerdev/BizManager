import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// GET /api/outflow-sources — the rows the תשלומים קבועים tab fetches when it opens.

const { requireRouteAccess, loadOutflowSources } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  loadOutflowSources: vi.fn(),
}));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/outflow-sources", () => ({ loadOutflowSources }));

import { GET } from "@/app/api/outflow-sources/route";

beforeEach(() => {
  requireRouteAccess.mockReset();
  loadOutflowSources.mockReset();
});

describe("GET /api/outflow-sources", () => {
  it("returns the gate's response when access is denied, without loading anything", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(loadOutflowSources).not.toHaveBeenCalled();
  });

  it("returns the loaded rows for staff", async () => {
    requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: {}, user: { id: "a" }, profile: { id: "p", role: "office" } } });
    loadOutflowSources.mockResolvedValue([{ kind: "card", key: "ויזה", name: "חיוב כרטיס: ויזה" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.rows).toHaveLength(1);
    expect(json.todayIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("maps a loader failure to a Hebrew error", async () => {
    requireRouteAccess.mockResolvedValue({ ok: true, value: { supabase: {}, user: { id: "a" }, profile: { id: "p", role: "admin" } } });
    loadOutflowSources.mockRejectedValue(new Error("boom"));
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBeTruthy();
  });
});
