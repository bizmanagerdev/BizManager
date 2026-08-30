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
function makeSupabase(tables: Tables) {
  const builder = (rows: Record<string, unknown>[]) => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "gte", "in", "or", "order", "range"]) {
      self[m] = () => self;
    }
    self.then = (onF: (v: { data: unknown; error: null }) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(onF, onR);
    return self;
  };
  return { from: (table: string) => builder(tables[table] ?? []) } as never;
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

  it("posts the batch once its settlement date has passed", async () => {
    const b = await balance({
      accounts: [account({ opening_date: "2020-01-01" })],
      payments: [
        ccPayment({ id: "p1", payment_date: "2019-12-05", due_date: "2020-01-10", amount_total: 500 }),
      ],
    });
    expect(b.postedIn).toBe(500);
    expect(b.pendingIn).toBe(0);
    expect(b.currentBalance).toBe(1500);
  });

  it("a credit_card payment with no due_date (or same-day) is NOT batched — behaves as before", async () => {
    const [overview] = await loadAccountsOverview(
      makeSupabase({
        accounts: [account({ opening_date: "2024-01-01" })],
        payments: [ccPayment({ id: "p1", payment_date: "2024-08-05", due_date: null })],
      })
    );
    expect(overview.ledger).toHaveLength(1);
    expect(overview.ledger[0].id).toBe("p:p1");
    expect(overview.ledger[0].posted).toBe(true); // status-based, cleared → posted immediately
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
    expect(await loadAccountsOverview(makeSupabase({ accounts: [] }))).toEqual([]);
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
});
