import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// POST /api/accounts/register-delete — the accounts page's register rows that
// have no route of their own (a loan, a repayment, a card charge, a transfer),
// deleted on the phone first and sent here from its queue (2026-10-27).

const { requireRouteAccess, deleteLoan, deleteRepayment } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  deleteLoan: vi.fn(),
  deleteRepayment: vi.fn(),
}));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("@/app/(app)/financial/loans/actions", () => ({ deleteLoan, deleteRepayment }));

import { POST } from "@/app/api/accounts/register-delete/route";

const deleted: Array<[string, string, string]> = [];
let deleteError: { message: string } | null = null;
const supabase = {
  from: (table: string) => ({
    delete: () => ({
      eq: async (column: string, value: string) => {
        deleted.push([table, column, value]);
        return { error: deleteError };
      },
    }),
  }),
};

function post(body: unknown) {
  return POST(new Request("http://test/api/accounts/register-delete", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  deleted.length = 0;
  deleteError = null;
  deleteLoan.mockReset().mockResolvedValue({ ok: true });
  deleteRepayment.mockReset().mockResolvedValue({ ok: true });
  requireRouteAccess.mockReset().mockResolvedValue({ ok: true, value: { supabase, profile: { id: "admin", role: "admin" } } });
});

describe("POST /api/accounts/register-delete", () => {
  it("admins only, as the accounts page", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const res = await post({ kind: "transfer", id: "tr1" });
    expect(res.status).toBe(403);
    expect(requireRouteAccess).toHaveBeenCalledWith({ allowedRoles: ["admin"] });
    expect(deleted).toEqual([]);
  });

  it("a loan and a repayment: through the loans page's own deletes", async () => {
    expect((await post({ kind: "loan", id: "l1" })).status).toBe(200);
    expect(deleteLoan).toHaveBeenCalledWith("l1");
    expect((await post({ kind: "loan_repayment", id: "r1", loan_id: "l1" })).status).toBe(200);
    expect(deleteRepayment).toHaveBeenCalledWith("r1", "l1");
  });

  it("a card charge and a transfer: their rows", async () => {
    expect((await post({ kind: "card_charge", id: "cc1" })).status).toBe(200);
    expect((await post({ kind: "transfer", id: "tr1" })).status).toBe(200);
    expect(deleted).toEqual([
      ["card_statement_charges", "id", "cc1"],
      ["account_transfers", "id", "tr1"],
    ]);
  });

  it("refused: says why (and the phone's copy goes back)", async () => {
    deleteRepayment.mockResolvedValue({ ok: false, error: "שגיאה במחיקת ההחזר." });
    const res = await post({ kind: "loan_repayment", id: "r1", loan_id: "l1" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("שגיאה במחיקת ההחזר.");
  });

  it("no id, or a kind it doesn't know: refused", async () => {
    expect((await post({ kind: "transfer" })).status).toBe(400);
    expect((await post({ kind: "payment", id: "p1" })).status).toBe(400);
    expect(deleted).toEqual([]);
  });
});
