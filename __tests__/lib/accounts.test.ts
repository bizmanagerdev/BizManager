import { describe, it, expect } from "vitest";
import {
  accountKindForMethod,
  defaultAccountForMethod,
  getAccountKindLabel,
  loadAccountBalances,
  loadAccountsOverview,
} from "@/lib/accounts";

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe("accountKindForMethod", () => {
  it("maps cash methods to the cash box", () => {
    expect(accountKindForMethod("cash")).toBe("cash");
    expect(accountKindForMethod("מזומן")).toBe("cash");
  });
  it("maps transfers, checks and bit to a bank account", () => {
    expect(accountKindForMethod("bank_transfer")).toBe("bank");
    expect(accountKindForMethod("check")).toBe("bank");
    expect(accountKindForMethod("bit")).toBe("bank");
  });
  it("maps credit card to a card account", () => {
    expect(accountKindForMethod("credit_card")).toBe("card");
  });
  it("returns null for empty/unknown methods", () => {
    expect(accountKindForMethod("")).toBeNull();
    expect(accountKindForMethod("frobnicate")).toBeNull();
  });
});

describe("defaultAccountForMethod", () => {
  const accounts = [
    { id: "bank1", kind: "bank" as const, isActive: true },
    { id: "cash1", kind: "cash" as const, isActive: true },
    { id: "bank2", kind: "bank" as const, isActive: true },
  ];
  it("auto-picks the single active account of the matching kind", () => {
    expect(defaultAccountForMethod(accounts, "cash")).toBe("cash1");
  });
  it("returns '' when the kind is ambiguous (more than one match)", () => {
    expect(defaultAccountForMethod(accounts, "bank_transfer")).toBe("");
  });
  it("returns '' when nothing matches", () => {
    expect(defaultAccountForMethod(accounts, "credit_card")).toBe("");
  });
});

describe("getAccountKindLabel", () => {
  it("returns Hebrew labels and a sensible fallback", () => {
    expect(getAccountKindLabel("bank")).toBe("בנק");
    expect(getAccountKindLabel("cash")).toBe("מזומן");
    expect(getAccountKindLabel(null)).toBe("חשבון");
  });
});

// ─── Balance engine (driven through a fake Supabase client) ───────────────────

type Tables = Record<string, Record<string, unknown>[]>;

/** Minimal chainable Supabase stub: every builder method is a no-op that returns
 *  the builder, and awaiting it resolves to `{ data: rows, error: null }`. The
 *  engine re-applies its own date/account filters in JS, so returning all rows
 *  for a table is faithful. */
function makeSupabase(tables: Tables, errorTables: string[] = []) {
  const builder = (allRows: Record<string, unknown>[], failing: boolean) => {
    let rows = allRows;
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "in", "or", "order", "range", "limit"]) {
      self[m] = () => self;
    }
    // The null filters are honoured, so the two payments reads (with an account
    // / card payments without one) never hand back the same row twice.
    self.is = (col: string, value: unknown) => {
      if (value === null) rows = rows.filter((r) => r[col] == null);
      return self;
    };
    self.not = (col: string, op: string, value: unknown) => {
      if (op === "is" && value === null) rows = rows.filter((r) => r[col] != null);
      return self;
    };
    // Used by business_settings lookups — the
    // first configured row, or null (caller falls back to its default).
    self.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    self.then = (onF: (v: { data: unknown; error: unknown }) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(
        failing
          ? { data: null, error: { message: "simulated query failure" } }
          : { data: rows, error: null }
      ).then(onF, onR);
    return self;
  };
  return {
    from: (table: string) => builder(tables[table] ?? [], errorTables.includes(table)),
  } as never;
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: "acc1",
    name: "עו״ש",
    kind: "bank",
    opening_balance: 1000,
    opening_date: "2024-01-01",
    is_active: true,
    sort_order: 0,
    notes: null,
    ...overrides,
  };
}

async function balance(tables: Tables, accountId = "acc1") {
  const balances = await loadAccountBalances(makeSupabase(tables));
  return balances.find((b) => b.id === accountId)!;
}

describe("loadAccountBalances — currentBalance = opening + postedIn − postedOut", () => {
  it("a collected payment increases the balance", async () => {
    const b = await balance({
      accounts: [account()],
      payments: [{ id: "p1", account_id: "acc1", payment_date: "2024-02-01", amount_total: 500, payment_status: "collected" }],
    });
    expect(b.postedIn).toBe(500);
    expect(b.currentBalance).toBe(1500);
  });

  it("a pending payment is reported as pendingIn and excluded from the balance", async () => {
    const b = await balance({
      accounts: [account()],
      payments: [{ id: "p1", account_id: "acc1", payment_date: "2024-02-01", due_date: "2024-09-01", amount_total: 500, payment_status: "pending" }],
    });
    expect(b.pendingIn).toBe(500);
    expect(b.postedIn).toBe(0);
    expect(b.currentBalance).toBe(1000);
  });

  it("a rejected (bounced) payment moves nothing", async () => {
    const b = await balance({
      accounts: [account()],
      payments: [{ id: "p1", account_id: "acc1", payment_date: "2024-02-01", amount_total: 500, payment_status: "rejected" }],
    });
    expect(b.postedIn).toBe(0);
    expect(b.pendingIn).toBe(0);
    expect(b.currentBalance).toBe(1000);
  });

  it("a refund (negative payment) is an outflow", async () => {
    const b = await balance({
      accounts: [account()],
      payments: [{ id: "p1", account_id: "acc1", payment_date: "2024-02-01", amount_total: -300, payment_status: "collected" }],
    });
    expect(b.postedOut).toBe(300);
    expect(b.currentBalance).toBe(700);
  });

  it("rows dated before the opening date are folded into the opening figure (ignored)", async () => {
    const b = await balance({
      accounts: [account({ opening_date: "2024-01-01" })],
      payments: [{ id: "p1", account_id: "acc1", payment_date: "2023-12-01", amount_total: 500, payment_status: "collected" }],
    });
    expect(b.postedIn).toBe(0);
    expect(b.currentBalance).toBe(1000);
  });

  it("counts a check taken before go-live but cashed after it", async () => {
    // The check was in a drawer on go-live day, so it is NOT part of the
    // opening balance — the bank only credits it on its פירעון date.
    const b = await balance({
      accounts: [account({ opening_date: "2024-06-01", opening_balance: 1000 })],
      payments: [
        {
          id: "p1",
          account_id: "acc1",
          payment_date: "2024-05-03",
          due_date: "2024-07-29",
          amount_total: 4254,
          payment_status: "collected",
        },
      ],
    });
    expect(b.postedIn).toBe(4254);
    expect(b.currentBalance).toBe(5254);
  });

  it("dates a post-dated check by its פירעון day, keeping the day it was written", async () => {
    const [acc] = await loadAccountsOverview(
      makeSupabase({
        accounts: [account({ opening_date: "2024-01-01" })],
        payments: [
          {
            id: "p1",
            account_id: "acc1",
            payment_date: "2024-05-03",
            due_date: "2024-07-29",
            amount_total: 4254,
            payment_status: "collected",
          },
        ],
      })
    );
    expect(acc.ledger[0]).toMatchObject({
      date: "2024-07-29",
      recordedDate: "2024-05-03",
    });
  });
});

describe("loadAccountBalances — expenses", () => {
  it("a paid expense is a posted outflow", async () => {
    const b = await balance({
      accounts: [account()],
      expenses: [{ id: "e1", account_id: "acc1", expense_date: "2024-02-01", amount: 200, payment_status: "paid" }],
    });
    expect(b.postedOut).toBe(200);
    expect(b.currentBalance).toBe(800);
  });

  it("a not-paid expense is pending only", async () => {
    const b = await balance({
      accounts: [account()],
      expenses: [{ id: "e1", account_id: "acc1", expense_date: "2024-02-01", amount: 200, payment_status: "not_paid" }],
    });
    expect(b.pendingOut).toBe(200);
    expect(b.postedOut).toBe(0);
    expect(b.currentBalance).toBe(1000);
  });

  it("a partial expense posts the paid portion and pends the remainder", async () => {
    const b = await balance({
      accounts: [account()],
      expenses: [{ id: "e1", account_id: "acc1", expense_date: "2024-02-01", amount: 400, paid_amount: 150, payment_status: "partial" }],
    });
    expect(b.postedOut).toBe(150);
    expect(b.pendingOut).toBe(250);
    expect(b.currentBalance).toBe(850);
  });

  it("a status-less legacy expense is treated as paid", async () => {
    const b = await balance({
      accounts: [account()],
      expenses: [{ id: "e1", account_id: "acc1", expense_date: "2024-02-01", amount: 200, payment_status: null }],
    });
    expect(b.postedOut).toBe(200);
  });
});

describe("loadAccountBalances — worker payments & loans", () => {
  it("a worker payment is always a posted outflow", async () => {
    const b = await balance({
      accounts: [account()],
      worker_payments: [{ id: "w1", account_id: "acc1", payment_date: "2024-02-01", amount: 250 }],
    });
    expect(b.postedOut).toBe(250);
    expect(b.currentBalance).toBe(750);
  });

  it("a taken loan brings cash in; repaying it takes cash out (full amount)", async () => {
    const b = await balance({
      accounts: [account({ opening_balance: 0 })],
      loans: [{ id: "L1", account_id: "acc1", direction: "taken", loan_date: "2024-02-01", amount: 10000 }],
      loan_repayments: [{ id: "lr1", account_id: "acc1", loan_id: "L1", repayment_date: "2024-03-01", amount: 1100 }],
    });
    expect(b.postedIn).toBe(10000);
    expect(b.postedOut).toBe(1100);
    expect(b.currentBalance).toBe(8900);
  });

  it("a given loan takes cash out; being repaid brings cash in", async () => {
    const b = await balance({
      accounts: [account({ opening_balance: 0 })],
      loans: [{ id: "L2", account_id: "acc1", direction: "given", loan_date: "2024-02-01", amount: 5000 }],
      loan_repayments: [{ id: "lr2", account_id: "acc1", loan_id: "L2", repayment_date: "2024-03-01", amount: 550 }],
    });
    expect(b.postedOut).toBe(5000);
    expect(b.postedIn).toBe(550);
    expect(b.currentBalance).toBe(-4450);
  });
});

describe("loadAccountBalances — transfers between our own accounts", () => {
  const twoAccounts = [
    account({ id: "bank", name: "עו״ש", opening_balance: 1000 }),
    account({ id: "cash", name: "קופה", kind: "cash", opening_balance: 0 }),
  ];

  it("moves money out of the source and into the destination, leaving total liquidity unchanged", async () => {
    const tables = {
      accounts: twoAccounts,
      account_transfers: [
        { id: "t1", from_account_id: "bank", to_account_id: "cash", amount: 400, transfer_date: "2024-02-01", notes: null },
      ],
    };
    const balances = await loadAccountBalances(makeSupabase(tables));
    const bank = balances.find((b) => b.id === "bank")!;
    const cash = balances.find((b) => b.id === "cash")!;

    expect(bank.postedOut).toBe(400);
    expect(bank.currentBalance).toBe(600);
    expect(cash.postedIn).toBe(400);
    expect(cash.currentBalance).toBe(400);
    // The whole point: a transfer never creates or destroys money.
    expect(bank.currentBalance + cash.currentBalance).toBe(1000);
  });

  it("posts each leg only against its own account's opening date", async () => {
    const balances = await loadAccountBalances(
      makeSupabase({
        accounts: [
          account({ id: "bank", opening_balance: 1000, opening_date: "2024-01-01" }),
          // Opened later — the transfer predates it, so it's already inside its opening figure.
          account({ id: "cash", kind: "cash", opening_balance: 400, opening_date: "2024-06-01" }),
        ],
        account_transfers: [
          { id: "t1", from_account_id: "bank", to_account_id: "cash", amount: 400, transfer_date: "2024-02-01", notes: null },
        ],
      })
    );
    expect(balances.find((b) => b.id === "bank")!.postedOut).toBe(400);
    expect(balances.find((b) => b.id === "cash")!.postedIn).toBe(0);
  });

  it("labels each leg with the other account and carries the transfer for edit/delete", async () => {
    const overview = await loadAccountsOverview(
      makeSupabase({
        accounts: twoAccounts,
        account_transfers: [
          { id: "t1", from_account_id: "bank", to_account_id: "cash", amount: 400, transfer_date: "2024-02-01", notes: "משיכה לקופה" },
        ],
      })
    );
    const out = overview.find((a) => a.id === "bank")!.ledger[0];
    const inRow = overview.find((a) => a.id === "cash")!.ledger[0];

    expect(out.type).toBe("out");
    expect(out.label).toBe("העברה לקופה");
    expect(out.sublabel).toBe("משיכה לקופה");
    expect(out.runningBalance).toBe(600);

    expect(inRow.type).toBe("in");
    expect(inRow.label).toBe("העברה מעו״ש");

    // Both legs carry the whole transfer, so the register can prefill the edit
    // form from either side without a second fetch.
    for (const leg of [out, inRow]) {
      expect(leg.transfer).toEqual({
        id: "t1",
        fromAccountId: "bank",
        toAccountId: "cash",
        amount: 400,
        date: "2024-02-01",
        notes: "משיכה לקופה",
      });
    }
  });
});

describe("loadAccountBalances — credit-card processor batches (e.g. Growth)", () => {
  // A credit_card payment whose due_date differs from payment_date represents
  // a clearing company's later lump-sum deposit (see lib/payments.ts
  // nextMonthTenth). Every such payment sharing an account + due_date must
  // fold into ONE ledger line instead of appearing individually.
  function ccPayment(overrides: Record<string, unknown> = {}) {
    return {
      account_id: "acc1",
      payment_method: "credit_card",
      payment_status: "cleared",
      amount_total: 340,
      payment_date: "2024-08-05",
      due_date: "2099-09-10", // far future, so posted/pending is deterministic regardless of "today"
      ...overrides,
    };
  }

  it("merges several deferred card payments sharing a due_date into one pending line", async () => {
    const [overview] = await loadAccountsOverview(
      makeSupabase({
        accounts: [account({ opening_date: "2024-01-01" })],
        payments: [
          ccPayment({ id: "p1", payment_date: "2024-08-05", amount_total: 340 }),
          ccPayment({ id: "p2", payment_date: "2024-08-12", amount_total: 340 }),
          ccPayment({ id: "p3", payment_date: "2024-08-20", amount_total: 340 }),
        ],
      })
    );
    expect(overview.pendingIn).toBe(1020);
    expect(overview.postedIn).toBe(0);
    expect(overview.ledger).toHaveLength(1);
    expect(overview.ledger[0]).toMatchObject({ date: "2099-09-10", amount: 1020, type: "in", posted: false });
    expect(overview.ledger[0].sublabel).toContain("3 תשלומים");
  });

  it("posts the batch once the deposit is confirmed", async () => {
    // A deposit arrives when someone confirms it landed on צפי תזרים — not merely
    // because its date has come.
    const b = await balance({
      accounts: [account({ opening_date: "2020-01-01" })],
      payments: [
        ccPayment({ id: "p1", payment_date: "2019-12-05", due_date: "2020-01-10", amount_total: 500 }),
      ],
      card_settlement_confirmations: [{ account_id: "acc1", settlement_date: "2020-01-10" }],
    });
    expect(b.postedIn).toBe(500);
    expect(b.pendingIn).toBe(0);
    expect(b.currentBalance).toBe(1500);
  });

  it("a past deposit nobody has confirmed stays expected, however old it is", async () => {
    const b = await balance({
      accounts: [account({ opening_date: "2020-01-01" })],
      payments: [
        ccPayment({ id: "p1", payment_date: "2019-12-05", due_date: "2020-01-10", amount_total: 500 }),
      ],
      card_settlement_confirmations: [],
    });
    expect(b.postedIn).toBe(0);
    expect(b.pendingIn).toBe(500);
    expect(b.currentBalance).toBe(1000);
  });

  it("a confirmation for a different day or account does not count", async () => {
    const b = await balance({
      accounts: [account({ opening_date: "2020-01-01" })],
      payments: [
        ccPayment({ id: "p1", payment_date: "2019-12-05", due_date: "2020-01-10", amount_total: 500 }),
      ],
      card_settlement_confirmations: [
        { account_id: "acc1", settlement_date: "2020-02-10" },
        { account_id: "other", settlement_date: "2020-01-10" },
      ],
    });
    expect(b.postedIn).toBe(0);
  });

  it("falls back to the date rule when the confirmations can't be read", async () => {
    // Before the migration is run (or on a failed read), a deposit must not
    // vanish from its account — it counts as arrived on its date, as it did.
    const [overview] = await loadAccountsOverview(
      makeSupabase(
        {
          accounts: [account({ opening_date: "2020-01-01" })],
          payments: [ccPayment({ id: "p1", payment_date: "2019-12-05", due_date: "2020-01-10", amount_total: 500 })],
        },
        ["card_settlement_confirmations"]
      )
    );
    expect(overview.postedIn).toBe(500);
  });

  it("a card payment with no due_date (or a same-day one) still lands in its month's deposit on the 10th", async () => {
    // Every card payment goes through the clearing company, so older rows that
    // never had a due date are grouped the same way as new ones.
    const [overview] = await loadAccountsOverview(
      makeSupabase(
        {
          accounts: [account({ opening_date: "2024-01-01" })],
          payments: [
            ccPayment({ id: "p1", payment_date: "2024-08-05", due_date: null, amount_total: 300 }),
            ccPayment({ id: "p2", payment_date: "2024-08-20", due_date: "2024-08-20", amount_total: 200 }),
          ],
        },
        ["card_settlement_confirmations"]
      )
    );
    expect(overview.ledger).toHaveLength(1);
    expect(overview.ledger[0].id).toBe("ccb:acc1:2024-09-10");
    expect(overview.ledger[0].amount).toBe(500);
    // Long past, no confirmations table → the date rule: arrived.
    expect(overview.ledger[0].posted).toBe(true);
  });

  it("files every card deposit under the account chosen on the Grow row", async () => {
    const overviews = await loadAccountsOverview(
      makeSupabase(
        {
          accounts: [account({ id: "acc1" }), account({ id: "acc2", name: "מזומן", kind: "cash" })],
          outflow_source_settings: [{ account_id: "acc1" }],
          payments: [
            ccPayment({ id: "p1", account_id: "acc2", payment_date: "2024-08-05", due_date: null, amount_total: 300 }),
            ccPayment({ id: "p2", account_id: null, payment_date: "2024-08-09", due_date: null, amount_total: 200 }),
            // Not a card payment: stays where it was recorded.
            { id: "p3", account_id: "acc2", payment_method: "cash", payment_status: "cleared", payment_date: "2024-08-06", amount_total: 50 },
          ],
        },
        ["card_settlement_confirmations"]
      )
    );
    const bank = overviews.find((o) => o.id === "acc1")!;
    const cash = overviews.find((o) => o.id === "acc2")!;
    expect(bank.ledger.map((r) => [r.id, r.amount])).toEqual([["ccb:acc1:2024-09-10", 500]]);
    expect(cash.ledger.map((r) => r.id)).toEqual(["p:p3"]);
  });

  it("ignores a stale due_date earlier than the month's deposit, keeps a later one", async () => {
    const [overview] = await loadAccountsOverview(
      makeSupabase({
        accounts: [account({ opening_date: "2024-01-01" })],
        payments: [
          // Paid in October, but still carrying September's deposit date.
          ccPayment({ id: "p1", payment_date: "2024-10-02", due_date: "2024-10-10", amount_total: 100 }),
          // Deliberately later than the month's deposit.
          ccPayment({ id: "p2", payment_date: "2024-10-03", due_date: "2024-12-10", amount_total: 50 }),
        ],
      })
    );
    expect(overview.ledger.map((r) => r.id).sort()).toEqual(["ccb:acc1:2024-11-10", "ccb:acc1:2024-12-10"]);
  });

  it("a card refund with a due_date is left on the normal per-row path, not batched", async () => {
    const [overview] = await loadAccountsOverview(
      makeSupabase({
        accounts: [account({ opening_date: "2024-01-01" })],
        payments: [ccPayment({ id: "p1", amount_total: -100, payment_date: "2024-08-05", due_date: "2024-09-10" })],
      })
    );
    expect(overview.ledger).toHaveLength(1);
    expect(overview.ledger[0].id).toBe("p:p1");
    expect(overview.ledger[0].type).toBe("out");
  });

  it("batches independently per account", async () => {
    const balances = await loadAccountBalances(
      makeSupabase({
        accounts: [
          account({ id: "bank1", opening_date: "2024-01-01" }),
          account({ id: "bank2", opening_date: "2024-01-01" }),
        ],
          payments: [
          ccPayment({ id: "p1", account_id: "bank1", amount_total: 300 }),
          ccPayment({ id: "p2", account_id: "bank2", amount_total: 700 }),
        ],
      })
    );
    expect(balances.find((b) => b.id === "bank1")!.pendingIn).toBe(300);
    expect(balances.find((b) => b.id === "bank2")!.pendingIn).toBe(700);
  });
});

describe("loadAccountBalances — credit-card batches post the gross amount", () => {
  // There is no fee percentage any more: the clearing company sends a receipt
  // for what it actually charged, and that is recorded as an ordinary expense.
  // A guessed rate was never the real figure, and one global rate rewrote the
  // amount of every past batch whenever it was edited.
  function ccPayment(overrides: Record<string, unknown> = {}) {
    return {
      account_id: "acc1",
      payment_method: "credit_card",
      payment_status: "cleared",
      amount_total: 1000,
      payment_date: "2024-08-05",
      due_date: "2099-09-10",
      ...overrides,
    };
  }

  it("counts the full amount the customers paid", async () => {
    const b = await balance({
      accounts: [account({ opening_date: "2024-01-01" })],
      payments: [ccPayment({ id: "p1" })],
    });
    expect(b.pendingIn).toBe(1000);
  });

  it("ignores a leftover cc_fee_rate still sitting in business_settings", async () => {
    // The column is left in the database (dropping it would be destructive and
    // gains nothing); nothing reads it.
    const b = await balance({
      accounts: [account({ opening_date: "2024-01-01" })],
      business_settings: [{ cc_fee_rate: 0.14 }],
      payments: [ccPayment({ id: "p1" })],
    });
    expect(b.pendingIn).toBe(1000);
  });

  it("the ledger row carries the gross amount and no fee note", async () => {
    const [overview] = await loadAccountsOverview(
      makeSupabase({
        accounts: [account({ opening_date: "2024-01-01" })],
        payments: [ccPayment({ id: "p1" })],
      })
    );
    expect(overview.ledger[0].amount).toBe(1000);
    expect(overview.ledger[0].sublabel).not.toContain("עמלת");
    expect(overview.ledger[0].sublabel).not.toContain("%");
  });
});

describe("loadAccountsOverview — running balance & register", () => {
  it("rolls the running balance chronologically and lists newest-first", async () => {
    const [overview] = await loadAccountsOverview(
      makeSupabase({
        accounts: [account({ opening_balance: 1000 })],
        payments: [{ id: "p1", account_id: "acc1", payment_date: "2024-02-01", amount_total: 500, payment_status: "collected" }],
        expenses: [
          { id: "e1", account_id: "acc1", expense_date: "2024-03-01", amount: 200, payment_status: "paid" },
          { id: "e2", account_id: "acc1", expense_date: "2024-04-01", amount: 100, payment_status: "not_paid" },
        ],
      })
    );

    expect(overview.currentBalance).toBe(1300); // 1000 + 500 − 200
    expect(overview.pendingOut).toBe(100);

    // Ledger is newest-first; the pending row carries a null running balance.
    expect(overview.ledger.map((l) => l.runningBalance)).toEqual([null, 1300, 1500]);
    const posted = overview.ledger.filter((l) => l.posted);
    expect(posted.map((l) => l.runningBalance)).toEqual([1300, 1500]);

    // A non-project expense has no record of its own — it must still deep-link
    // to its exact ledger entry (not dump the reader on the bare /financial
    // page with no way to find it there).
    const byId = Object.fromEntries(overview.ledger.map((l) => [l.id, l]));
    expect(byId["e:e1"].href).toBe("/financial?focus=expense%3Ae1");
    expect(byId["e:e2:p"].href).toBe("/financial?focus=expense%3Ae2");
  });

  it("returns an empty list when there are no accounts", async () => {
    const overview = await loadAccountsOverview(makeSupabase({ accounts: [] }));
    expect(overview).toHaveLength(0);
    // Still carries the completeness metadata (see below) — just trivially
    // "complete" since no scan ever ran.
    expect(overview.dataIncomplete).toBe(false);
  });

  it("flags dataIncomplete and names the failed table when a scan errors, rather than silently returning as if nothing were wrong", async () => {
    const result = await loadAccountsOverview(
      makeSupabase(
        { accounts: [account()], payments: [{ id: "p1", account_id: "acc1", payment_date: "2024-02-01", amount_total: 500, payment_status: "collected" }] },
        ["expenses"] // simulate exactly the real incident: one table's query fails
      )
    );
    expect(result.dataIncomplete).toBe(true);
    expect(result.incompleteTables).toContain("expenses");
    // The OTHER tables still contribute normally — a failure in one table must
    // not zero out everything, only make the result honest about what's missing.
    expect(result[0].postedIn).toBe(500);
  });

  it("dataIncomplete stays false when every table scans cleanly", async () => {
    const result = await loadAccountsOverview(
      makeSupabase({
        accounts: [account()],
        payments: [{ id: "p1", account_id: "acc1", payment_date: "2024-02-01", amount_total: 500, payment_status: "collected" }],
      })
    );
    expect(result.dataIncomplete).toBe(false);
    expect(result.incompleteTables).toEqual([]);
  });

  it("enriches ledger rows with worker, customer (+phone) and project context", async () => {
    const [overview] = await loadAccountsOverview(
      makeSupabase({
        accounts: [account()],
        payments: [
          { id: "p1", account_id: "acc1", payment_date: "2024-02-01", amount_total: 500, payment_status: "collected", order_id: "o1" },
        ],
        orders: [{ id: "o1", customer_id: "c1" }],
        customers: [{ id: "c1", name: "דנה לוי", phone: "050-1234567" }],
        worker_payments: [
          { id: "w1", account_id: "acc1", payment_date: "2024-02-02", amount: 250, user_id: "u1", notes: "תשלום עבור משמרת" },
        ],
        worker_payment_allocations: [{ worker_payment_id: "w1", attendance_session_id: "s1" }],
        attendance_sessions: [{ id: "s1", project_id: "pr1" }],
        users: [{ id: "u1", full_name: "יוסי כהן" }],
        projects: [{ id: "pr1", name: "מעבר דירה", customer_id: "c1" }],
      })
    );

    const byId = Object.fromEntries(overview.ledger.map((l) => [l.id, l]));
    expect(byId["p:p1"].sublabel).toBe("לקוח: דנה לוי (050-1234567)");
    expect(byId["p:p1"].href).toBe("/sales/orders/o1");
    expect(byId["w:w1"].sublabel).toBe("עובד: יוסי כהן · פרויקט: מעבר דירה");
    expect(byId["w:w1"].href).toBe("/payroll/workers/u1");
  });

  it("shows the business domain on every applicable row, plus the property/project only when the domain matches", async () => {
    const [overview] = await loadAccountsOverview(
      makeSupabase({
        accounts: [account()],
        payments: [
          {
            id: "p1", account_id: "acc1", payment_date: "2024-02-01", amount_total: 500,
            payment_status: "collected", business_domain: "logistics_projects", project_id: "pr1",
          },
          {
            id: "p2", account_id: "acc1", payment_date: "2024-02-03", amount_total: 300,
            payment_status: "collected", business_domain: "general_business",
          },
        ],
        expenses: [
          {
            id: "e1", account_id: "acc1", expense_date: "2024-03-01", amount: 200,
            payment_status: "paid", business_domain: "property_management", property_id: "prop1",
          },
        ],
        loans: [
          {
            id: "l1", account_id: "acc1", direction: "taken", loan_date: "2024-01-15",
            amount: 1000, lender: "בנק הפועלים", business_domain: "sales",
          },
        ],
        projects: [{ id: "pr1", name: "מעבר דירה" }],
        properties: [{ id: "prop1", name: null, address: "הרצל 5, תל אביב" }],
      })
    );

    const byId = Object.fromEntries(overview.ledger.map((l) => [l.id, l]));
    expect(byId["p:p1"].sublabel).toBe("תחום: פרויקטים · פרויקט: מעבר דירה");
    expect(byId["p:p2"].sublabel).toBe("תחום: שוטף");
    expect(byId["e:e1"].sublabel).toBe("תחום: ניהול נכסים · נכס: הרצל 5, תל אביב");
    expect(byId["l:l1"].sublabel).toBe("תחום: מכירות · מלווה: בנק הפועלים");
  });
});
