import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for GET /api/search-index/[kind] — the customer / order /
// project lists behind the app's instant type-ahead. A plain GET (these used to
// be server actions, which Next queues one at a time with router refreshes).

const { requireRouteAccess, loadCustomerSearchIndexRows, loadOrderSearchIndexRows, loadProjectSearchIndexRows } =
  vi.hoisted(() => ({
    requireRouteAccess: vi.fn(),
    loadCustomerSearchIndexRows: vi.fn(),
    loadOrderSearchIndexRows: vi.fn(),
    loadProjectSearchIndexRows: vi.fn(),
  }));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/app/(app)/customers/loadCustomers", () => ({ loadCustomerSearchIndexRows }));
vi.mock("@/app/(app)/sales/loadOrders", () => ({ loadOrderSearchIndexRows }));
vi.mock("@/app/(app)/projects/loadProjects", () => ({ loadProjectSearchIndexRows }));

import { GET } from "@/app/api/search-index/[kind]/route";

const supabase = {};

function get(kind: string) {
  return GET(new Request(`http://test/api/search-index/${kind}`), { params: Promise.resolve({ kind }) });
}

beforeEach(() => {
  requireRouteAccess.mockReset();
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "u1", role: "office" } },
  });
  loadCustomerSearchIndexRows.mockReset().mockResolvedValue([{ id: "c1" }]);
  loadOrderSearchIndexRows.mockReset().mockResolvedValue([{ id: "o1" }]);
  loadProjectSearchIndexRows.mockReset().mockResolvedValue([{ id: "p1" }]);
});

describe("GET /api/search-index/[kind]", () => {
  it.each([
    ["customers", loadCustomerSearchIndexRows, [{ id: "c1" }]],
    ["orders", loadOrderSearchIndexRows, [{ id: "o1" }]],
    ["projects", loadProjectSearchIndexRows, [{ id: "p1" }]],
  ])("returns the %s index, loaded with the caller's own client", async (kind, loader, rows) => {
    const res = await get(kind);
    expect(res.status).toBe(200);
    expect(loader).toHaveBeenCalledWith(supabase);
    expect(await res.json()).toEqual({ rows });
  });

  it("404s an unknown kind without touching auth or the database", async () => {
    const res = await get("users");
    expect(res.status).toBe(404);
    expect(requireRouteAccess).not.toHaveBeenCalled();
  });

  it("passes a refused caller's response straight through, loading nothing", async () => {
    requireRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "No access" }, { status: 401 }),
    });
    const res = await get("customers");
    expect(res.status).toBe(401);
    expect(loadCustomerSearchIndexRows).not.toHaveBeenCalled();
  });
});
