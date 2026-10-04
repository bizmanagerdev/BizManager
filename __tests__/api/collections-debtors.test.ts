import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for GET /api/collections/debtors — the "who owes money" roster
// behind the top-bar קליטת תשלום dialog.

const { requireRouteAccess, getCollectionsData } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  getCollectionsData: vi.fn(),
}));

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/collections", () => ({ getCollectionsData }));

import { GET } from "@/app/api/collections/debtors/route";

const supabase = {};

beforeEach(() => {
  requireRouteAccess.mockReset();
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "u1", role: "office" } },
  });
  getCollectionsData.mockReset();
  getCollectionsData.mockResolvedValue({
    customers: [
      { customer_id: "c1", customer_name: "א", customer_phone: "050", outstanding_amount: 500, overdue_amount: 200, sources: [] },
      { customer_id: "c2", customer_name: "ב", customer_phone: null, outstanding_amount: 0, overdue_amount: 0, sources: [] },
      { customer_id: null, customer_name: "ללא", customer_phone: null, outstanding_amount: 90, overdue_amount: 0, sources: [] },
    ],
  });
});

describe("GET /api/collections/debtors", () => {
  it("asks for amounts only, and lists just the customers who owe something", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(getCollectionsData).toHaveBeenCalledWith(supabase, { amountsOnly: true });
    expect((await res.json()).debtors).toEqual([
      { customer_id: "c1", customer_name: "א", customer_phone: "050", outstanding_amount: 500, overdue_amount: 200 },
    ]);
  });

  it("passes a refused caller's response straight through", async () => {
    requireRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "No access" }, { status: 403 }),
    });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(getCollectionsData).not.toHaveBeenCalled();
  });
});
