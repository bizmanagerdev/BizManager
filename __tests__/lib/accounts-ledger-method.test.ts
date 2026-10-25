import { describe, it, expect } from "vitest";
import { loadAccountsOverview } from "@/lib/accounts";

// The חשבונות register says how each line's money moved — cash, check (with its
// number), transfer — so it can be matched against the bank's statement
// (owner, 2026-10-25).

type Tables = Record<string, Record<string, unknown>[]>;

/** Chainable Supabase stub (as in accounts.test.ts): every filter is a no-op,
 *  except the null ones, and awaiting resolves to the table's rows. */
function makeSupabase(tables: Tables) {
  const builder = (allRows: Record<string, unknown>[]) => {
    let rows = allRows;
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "in", "or", "order", "range", "limit"]) {
      self[m] = () => self;
    }
    self.is = (col: string, value: unknown) => {
      if (value === null) rows = rows.filter((r) => r[col] == null);
      return self;
    };
    self.not = (col: string, op: string, value: unknown) => {
      if (op === "is" && value === null) rows = rows.filter((r) => r[col] != null);
      return self;
    };
    self.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    self.then = (onF: (v: { data: unknown; error: unknown }) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(onF, onR);
    return self;
  };
  return { from: (table: string) => builder(tables[table] ?? []) } as never;
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: "bank",
    name: "מזרחי עסקי",
    kind: "bank",
    opening_balance: 0,
    opening_date: "2026-07-01",
    is_active: true,
    sort_order: 0,
    notes: null,
    ...overrides,
  };
}

async function ledgerOf(tables: Tables, accountId = "bank") {
  const overview = await loadAccountsOverview(makeSupabase(tables));
  const found = overview.find((a) => a.id === accountId);
  if (!found) throw new Error(`no account ${accountId}`);
  return new Map(found.ledger.map((row) => [row.id, row] as const));
}

describe("loadAccountsOverview — each line's payment method", () => {
  it("a payment by check carries its number; by transfer, by cash, and none", async () => {
    const ledger = await ledgerOf({
      accounts: [account()],
      payments: [
        { id: "p1", account_id: "bank", payment_date: "2026-08-01", amount_total: 500, payment_status: "collected", payment_method: "check", check_number: " 1234 " },
        { id: "p2", account_id: "bank", payment_date: "2026-08-02", amount_total: 300, payment_status: "collected", payment_method: "bank_transfer" },
        { id: "p3", account_id: "bank", payment_date: "2026-08-03", amount_total: 200, payment_status: "collected", payment_method: "מזומן" },
        { id: "p4", account_id: "bank", payment_date: "2026-08-04", amount_total: 100, payment_status: "collected", payment_method: null },
      ],
    });
    expect(ledger.get("p:p1")).toMatchObject({ method: "check", checkNumber: "1234" });
    expect(ledger.get("p:p2")).toMatchObject({ method: "bank_transfer", checkNumber: null });
    expect(ledger.get("p:p3")).toMatchObject({ method: "cash" });
    expect(ledger.get("p:p4")?.method).toBeNull();
  });

  it("expenses (both halves of a part-paid one), wages, loans and repayments", async () => {
    const ledger = await ledgerOf({
      accounts: [account()],
      expenses: [
        { id: "e1", account_id: "bank", expense_date: "2026-08-05", amount: 400, paid_amount: 100, payment_status: "partial", payment_method: "bank_transfer" },
      ],
      worker_payments: [{ id: "w1", account_id: "bank", payment_date: "2026-08-06", amount: 900, payment_method: "cash" }],
      loans: [{ id: "l1", account_id: "bank", direction: "taken", loan_date: "2026-08-07", amount: 5000, loan_method: "bank_transfer" }],
      loan_repayments: [{ id: "r1", account_id: "bank", loan_id: "l1", repayment_date: "2026-08-08", amount: 700, method: "cash" }],
    });
    expect(ledger.get("e:e1")?.method).toBe("bank_transfer");
    expect(ledger.get("e:e1:p")?.method).toBe("bank_transfer");
    expect(ledger.get("w:w1")?.method).toBe("cash");
    expect(ledger.get("l:l1")?.method).toBe("bank_transfer");
    expect(ledger.get("lr:r1")?.method).toBe("cash");
  });

  it("a transfer with the cash box on either side is cash (a deposit, a withdrawal); between banks, a transfer", async () => {
    const tables: Tables = {
      accounts: [account(), account({ id: "home", name: "מזרחי בית" }), account({ id: "cash", name: "מזומן", kind: "cash" })],
      account_transfers: [
        { id: "t1", from_account_id: "cash", to_account_id: "bank", amount: 2000, transfer_date: "2026-08-09" },
        { id: "t2", from_account_id: "bank", to_account_id: "cash", amount: 600, transfer_date: "2026-08-10" },
        { id: "t3", from_account_id: "bank", to_account_id: "home", amount: 1000, transfer_date: "2026-08-11" },
      ],
    };
    const bank = await ledgerOf(tables);
    expect(bank.get("t:t1:in")?.method).toBe("cash");
    expect(bank.get("t:t2:out")?.method).toBe("cash");
    expect(bank.get("t:t3:out")?.method).toBe("bank_transfer");
    const cash = await ledgerOf(tables, "cash");
    expect(cash.get("t:t1:out")?.method).toBe("cash");
    const home = await ledgerOf(tables, "home");
    expect(home.get("t:t3:in")?.method).toBe("bank_transfer");
  });

  it("a card's monthly charge and a Grow deposit are by card", async () => {
    const ledger = await ledgerOf({
      accounts: [account()],
      card_statement_charges: [{ id: "c1", statement_id: "s1", card_label: "ויזה", account_id: "bank", amount: 3000, charge_date: "2026-08-02" }],
      payments: [
        { id: "g1", account_id: "bank", payment_date: "2026-08-12", amount_total: 250, payment_status: "collected", payment_method: "credit_card" },
      ],
    });
    expect(ledger.get("cc:c1")?.method).toBe("credit_card");
    const grow = [...ledger.values()].find((row) => row.id.startsWith("ccb:"));
    expect(grow?.method).toBe("credit_card");
  });
});
