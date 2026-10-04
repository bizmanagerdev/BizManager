import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for GET /api/quick-actions/data — the lists behind every
// quick-create (+) dialog. It authenticates with requireRouteAccess() (session
// from the cookie, no Auth-server round trip) and returns the lists plus who's
// asking, which the dialogs use to default the assignee and gate sections.

const { requireRouteAccess, loadQuickActionsData } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  loadQuickActionsData: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/app/(app)/dashboard/quick-actions-data", () => ({ loadQuickActionsData }));

import { GET } from "@/app/api/quick-actions/data/route";

const LISTS = { customers: [{ id: "c1" }], products: [], projects: [{ id: "p1" }], orders: [], properties: [], users: [] };

beforeEach(() => {
  requireRouteAccess.mockReset();
  loadQuickActionsData.mockReset();
  loadQuickActionsData.mockResolvedValue(LISTS);
});

describe("GET /api/quick-actions/data", () => {
  it("returns the lists plus who's asking", async () => {
    const supabase = {};
    requireRouteAccess.mockResolvedValue({
      ok: true,
      value: { supabase, user: { id: "auth-1" }, profile: { id: "u1", role: "worker", locale: "ar" } },
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(loadQuickActionsData).toHaveBeenCalledWith(supabase, { id: "u1" });
    expect(body).toEqual({ ...LISTS, currentUserId: "u1", role: "worker", locale: "ar" });
  });

  it("passes a refused caller's response straight through, loading nothing", async () => {
    requireRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "No access" }, { status: 403 }),
    });

    const res = await GET();

    expect(res.status).toBe(403);
    expect(loadQuickActionsData).not.toHaveBeenCalled();
  });
});
