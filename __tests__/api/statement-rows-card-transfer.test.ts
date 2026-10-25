import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase, type MockTableConfig } from "@/__tests__/mocks/supabase-query-builder";

// POST/DELETE /api/expenses/statement-rows/card-transfer — a US card kept as its
// own account (owner, 2026-10-25: "payments to it as transfers"). A payment line
// is the transfer from the bank into the card: linked when the bank's side was
// entered already, made otherwise. Cash taken on the card goes out of it.

const { requireRouteAccess } = vi.hoisted(() => ({ requireRouteAccess: vi.fn() }));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));

import { POST, DELETE } from "@/app/api/expenses/statement-rows/card-transfer/route";

const paymentRow = {
  id: "r1",
  statement_id: "s1",
  amount: -3100,
  line_kind: "payment",
  transfer_id: null,
  expense_id: null,
  income_payment_id: null,
  description: "CAPITAL ONE MOBILE PYMT",
  card_label: "Venture X 9738",
  expense_date: "2026-08-17",
};

function setup(tables: Record<string, MockTableConfig>) {
  const base = makeSupabase({
    card_statements: { data: { card_account_id: "venture-x", currency: "USD" }, error: null },
    ...tables,
  });
  const supabase = { ...base, rpc: vi.fn(async () => ({ data: 3, error: null })) };
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase, user: { id: "auth-1" }, profile: { id: "prof-1", role: "admin" } },
  });
  return base;
}

const call = (handler: typeof POST, body: Record<string, unknown>) =>
  handler(new Request("http://test/api/expenses/statement-rows/card-transfer", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => requireRouteAccess.mockReset());

describe("card-transfer — a payment line", () => {
  it("makes the transfer from the bank into the card, in dollars on both sides, and links the line", async () => {
    const sb = setup({
      card_statement_rows: { read: { data: paymentRow, error: null }, write: { data: [{ id: "r1" }], error: null } },
      accounts: { data: { id: "capital-one", name: "Capital One 360 Checking", currency: "USD" }, error: null },
      account_transfers: { read: { data: null, error: null }, write: { data: { id: "t1" }, error: null } },
    });
    const res = await call(POST, { row_id: "r1", account_id: "capital-one", date: "2026-08-17" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ transfer_id: "t1", created: true });
    expect(sb.calls.insert.account_transfers).toEqual([
      expect.objectContaining({
        from_account_id: "capital-one",
        to_account_id: "venture-x",
        from_amount: 3100,
        to_amount: 3100,
        transfer_date: "2026-08-17",
        notes: "תשלום לכרטיס Venture X 9738: CAPITAL ONE MOBILE PYMT",
      }),
    ]);
    // A payment line is never "left out" — it was never a purchase.
    expect(sb.calls.update.card_statement_rows).toEqual([{ transfer_id: "t1" }]);
  });

  it("links a payment entered from the bank's side instead of making a second one", async () => {
    const sb = setup({
      card_statement_rows: { read: { data: paymentRow, error: null }, write: { data: [{ id: "r1" }], error: null } },
      account_transfers: {
        data: { id: "t9", from_account_id: "capital-one", to_account_id: "venture-x", from_amount: 3100, to_amount: 3100, transfer_date: "2026-08-16" },
        error: null,
      },
    });
    const res = await call(POST, { row_id: "r1", transfer_id: "t9" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ transfer_id: "t9", created: false });
    expect(sb.calls.insert.account_transfers).toBeUndefined();
    expect(sb.calls.update.card_statement_rows).toEqual([{ transfer_id: "t9" }]);
  });

  it("won't link a transfer of other dollars, or into another card", async () => {
    setup({
      card_statement_rows: { data: paymentRow, error: null },
      account_transfers: {
        data: { id: "t9", from_account_id: "chase", to_account_id: "venture-x", to_amount: 3000, transfer_date: "2026-08-16" },
        error: null,
      },
    });
    expect((await call(POST, { row_id: "r1", transfer_id: "t9" })).status).toBe(400);

    setup({
      card_statement_rows: { data: paymentRow, error: null },
      account_transfers: {
        data: { id: "t9", from_account_id: "chase", to_account_id: "sapphire", to_amount: 3100, transfer_date: "2026-08-16" },
        error: null,
      },
    });
    expect((await call(POST, { row_id: "r1", transfer_id: "t9" })).status).toBe(400);
  });

  it("is refused on an Israeli statement", async () => {
    setup({ card_statements: { data: { card_account_id: null, currency: "ILS" }, error: null }, card_statement_rows: { data: paymentRow, error: null } });
    expect((await call(POST, { row_id: "r1", account_id: "x", date: "2026-08-17" })).status).toBe(400);
  });
});

describe("card-transfer — cash", () => {
  it("a cash advance leaves the card in dollars and arrives in the cash box in shekels", async () => {
    const sb = setup({
      card_statement_rows: {
        read: { data: { ...paymentRow, amount: 602.95, line_kind: "cash_advance", description: "BANK ATM" }, error: null },
        write: { data: [{ id: "r1" }], error: null },
      },
      accounts: { data: { id: "cash", name: "מזומן", currency: "ILS" }, error: null },
      account_transfers: { read: { data: null, error: null }, write: { data: { id: "t2" }, error: null } },
    });
    const res = await call(POST, { row_id: "r1", account_id: "cash", date: "2026-07-31", shekels: 1839 });
    expect(res.status).toBe(200);
    expect(sb.calls.insert.account_transfers).toEqual([
      expect.objectContaining({ from_account_id: "venture-x", to_account_id: "cash", from_amount: 602.95, to_amount: null, amount: 1839 }),
    ]);
    // A cash advance stays as it is — only a purchase is left out when it becomes cash.
    expect(sb.calls.update.card_statement_rows).toEqual([{ transfer_id: "t2" }]);
  });

  const undo = (body: Record<string, unknown>) =>
    DELETE(
      new Request("http://test/api/expenses/statement-rows/card-transfer", { method: "DELETE", body: JSON.stringify(body) })
    );

  it("undo unlinks a payment line, and deletes the transfer only when asked", async () => {
    const sb = setup({ card_statement_rows: { data: { ...paymentRow, transfer_id: "t1" }, error: null } });
    expect((await undo({ row_id: "r1" })).status).toBe(200);
    expect(sb.calls.update.card_statement_rows).toEqual([{ transfer_id: null }]);
    expect(sb.calls.delete.account_transfers).toBeUndefined();

    const sb2 = setup({ card_statement_rows: { data: { ...paymentRow, transfer_id: "t1" }, error: null } });
    expect((await undo({ row_id: "r1", delete_transfer: true })).status).toBe(200);
    expect(sb2.calls.delete.account_transfers).toBe(1);
  });

  it("undoing \"מול מזומן\" puts the purchase back to wait for its domain", async () => {
    const sb = setup({
      card_statement_rows: { data: { ...paymentRow, amount: 50, line_kind: "charge", transfer_id: "t5" }, error: null },
    });
    expect((await undo({ row_id: "r1", delete_transfer: true })).status).toBe(200);
    expect(sb.calls.update.card_statement_rows).toEqual([{ transfer_id: null, include: true }]);
  });
});
