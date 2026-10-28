import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// POST /api/device-check/card — the daily check's second look: one page part
// worked out from the server's data now, with the device's own code, for the
// person asking (2026-10-28).

const { requireRouteAccess, computeLocalCard } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  computeLocalCard: vi.fn(),
}));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/powersync/dashboard-local", () => ({
  computeLocalCard,
  LOCAL_CARD_TABLES: { bankPage: [], salesOrders: [] },
}));

import { POST } from "@/app/api/device-check/card/route";

const supabase = { tag: "server client" };

function post(body: unknown) {
  return POST(new Request("http://test/api/device-check/card", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  computeLocalCard.mockReset().mockResolvedValue({ accounts: [] });
  requireRouteAccess.mockReset().mockResolvedValue({
    ok: true,
    value: { supabase, profile: { id: "u1", role: "office", locale: "he" } },
  });
});

describe("POST /api/device-check/card", () => {
  it("signed in only", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    expect((await post({ card: "bankPage" })).status).toBe(401);
    expect(computeLocalCard).not.toHaveBeenCalled();
  });

  it("works the part out from the server's data, as the person asking — not anyone the request names", async () => {
    const res = await post({ card: "salesOrders", filters: { tab: "open" }, userId: "someone-else", role: "admin" });
    expect(res.status).toBe(200);
    expect(computeLocalCard).toHaveBeenCalledWith(
      supabase,
      "salesOrders",
      { userId: "u1", role: "office", locale: "he" },
      { tab: "open" },
      { onServer: true }
    );
    const json = await res.json();
    expect(json.data).toEqual({ accounts: [] });
    expect(typeof json.renderedAt).toBe("string");
  });

  it("a part it doesn't know: refused", async () => {
    expect((await post({ card: "everything" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(computeLocalCard).not.toHaveBeenCalled();
  });
});
