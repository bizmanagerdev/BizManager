import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Contract tests for GET /api/financial/entries — the full ledger and upcoming
// lists /financial loads right after the page (which is sent with only its
// newest rows). Built by the same loader as the page, for the same filters.

const { requireRouteAccess, ensureRecurringExpensesForDate, loadCashFlowData, loadCashFlowProjections } = vi.hoisted(
  () => ({
    requireRouteAccess: vi.fn(),
    ensureRecurringExpensesForDate: vi.fn(),
    loadCashFlowData: vi.fn(),
    loadCashFlowProjections: vi.fn(),
  })
);

vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/lib/recurring-expenses", () => ({ ensureRecurringExpensesForDate }));
vi.mock("@/lib/financial/cashFlowPage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/financial/cashFlowPage")>()),
  loadCashFlowData,
  loadCashFlowProjections,
}));

import { GET } from "@/app/api/financial/entries/route";

const supabase = {};

beforeEach(() => {
  requireRouteAccess.mockReset().mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "u1", role: "admin" } },
  });
  ensureRecurringExpensesForDate.mockReset().mockResolvedValue({ ok: true });
  loadCashFlowProjections.mockReset().mockReturnValue(Promise.resolve([]));
  loadCashFlowData.mockReset().mockResolvedValue({
    ledgerEntries: [{ id: "a" }],
    upcomingEntries: [{ id: "b" }],
    profitLossProof: { big: true },
  });
});

describe("GET /api/financial/entries", () => {
  it("is admin-only, like /financial", async () => {
    await GET(new Request("http://test/api/financial/entries"));
    expect(requireRouteAccess).toHaveBeenCalledWith({ allowedRoles: ["admin"] });
  });

  it("returns just the two lists, for the page's filters, after today's recurring expenses exist", async () => {
    const res = await GET(
      new Request("http://test/api/financial/entries?from=2026-01-01&type=outflow&customer_id=c1&focus=expense:1")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ledgerEntries: [{ id: "a" }], upcomingEntries: [{ id: "b" }] });
    expect(ensureRecurringExpensesForDate).toHaveBeenCalledWith(supabase);
    const args = loadCashFlowData.mock.calls[0][1];
    expect(args.customerId).toBe("c1");
    expect(args.notBefore).toBeNull();
    expect(args.filters).toMatchObject({ from: "2026-01-01", type: "outflow", stage: "all", q: "" });
    expect(ensureRecurringExpensesForDate.mock.invocationCallOrder[0]).toBeLessThan(
      loadCashFlowData.mock.invocationCallOrder[0]
    );
  });

  it("passes a refused caller's response straight through, loading nothing", async () => {
    requireRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "No access" }, { status: 403 }),
    });
    const res = await GET(new Request("http://test/api/financial/entries"));
    expect(res.status).toBe(403);
    expect(loadCashFlowData).not.toHaveBeenCalled();
  });

  it("reports a failed load as a 500", async () => {
    loadCashFlowData.mockRejectedValue(new Error("boom"));
    const res = await GET(new Request("http://test/api/financial/entries"));
    expect(res.status).toBe(500);
  });
});
