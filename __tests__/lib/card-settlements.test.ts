import { describe, it, expect } from "vitest";
import {
  NO_CONFIRMATIONS,
  cardScanSince,
  cardSettlementDate,
  depositDaysToConfirm,
  isSettlementArrived,
  settlementAccountFor,
  labelSettlementPayments,
  loadSettlementConfirmations,
  settlementKey,
} from "@/lib/card-settlements";
import { groupSettlementBatches, toSettlementItems } from "@/lib/receivables-forecast";

// A credit-card clearing deposit has arrived only once someone confirms it.
// Kept apart from the payments' own status on purpose: a card payment is
// "cleared" because the customer paid, which is not the same event as the
// clearing company depositing the month's total into our account.

const TODAY = "2026-09-17";
const confirmed = (...keys: string[]) => ({ available: true, confirmed: new Set(keys) });

describe("cardSettlementDate — when a card payment reaches the bank", () => {
  const card = (paymentDate: string, dueDate: string | null = null, amount = 100) =>
    cardSettlementDate({ paymentMethod: "credit_card", paymentDate, dueDate, amount });

  it("every card payment of a month lands on the 10th of the next month", () => {
    expect(card("2026-09-01")).toBe("2026-10-10");
    expect(card("2026-09-30")).toBe("2026-10-10");
    expect(card("2026-12-15")).toBe("2027-01-10");
  });

  it("works back: an old row with no due date, or a same-day one, follows the same rule", () => {
    expect(card("2026-04-12", null)).toBe("2026-05-10");
    expect(card("2026-04-12", "2026-04-12")).toBe("2026-05-10");
  });

  it("keeps a due date that is later than the month's deposit, not an earlier or stale one", () => {
    expect(card("2026-09-05", "2026-12-10")).toBe("2026-12-10");
    // Paid in October but still carrying September's deposit date.
    expect(card("2026-10-02", "2026-10-10")).toBe("2026-11-10");
  });

  it("is only for incoming card money", () => {
    expect(cardSettlementDate({ paymentMethod: "check", paymentDate: "2026-09-05", dueDate: null, amount: 100 })).toBeNull();
    // A refund leaves on its own day.
    expect(card("2026-09-05", null, -100)).toBeNull();
    expect(cardSettlementDate({ paymentMethod: " Credit_Card ", paymentDate: "2026-09-05", dueDate: null, amount: 100 })).toBe("2026-10-10");
    expect(cardSettlementDate({ paymentMethod: "credit_card", paymentDate: null, dueDate: null, amount: 100 })).toBeNull();
  });
});

describe("settlementAccountFor — the account chosen on the Grow row wins", () => {
  it("files every deposit under the chosen account, else the payment's own", () => {
    const chosen = { available: true, confirmed: new Set<string>(), depositAccountId: "acc-bank" };
    expect(settlementAccountFor("acc-cash", chosen)).toBe("acc-bank");
    expect(settlementAccountFor(null, chosen)).toBe("acc-bank");
    expect(settlementAccountFor("acc-cash", NO_CONFIRMATIONS)).toBe("acc-cash");
    expect(settlementAccountFor(null, NO_CONFIRMATIONS)).toBeNull();
  });
});

describe("depositDaysToConfirm — choosing the account keeps arrived deposits arrived", () => {
  const pay = (accountId: string | null, paymentDate: string) => ({ accountId, paymentDate, dueDate: null, amount: 100 });

  it("confirms the days whose deposits had all arrived, as they were filed before", () => {
    const before = confirmed(settlementKey("acc-cash", "2026-08-10"));
    const days = depositDaysToConfirm({
      payments: [
        pay("acc-cash", "2026-07-05"), // Aug 10, confirmed on the cash account
        pay(null, "2026-06-05"), // Jul 10, no account: arrived on its day
        pay("acc-bank", "2026-08-20"), // Sep 10 on the bank account, never confirmed
        pay(null, "2026-09-03"), // Oct 10, still ahead
      ],
      confirmations: before,
      todayIso: TODAY,
    });
    expect(days).toEqual(["2026-07-10", "2026-08-10"]);
  });

  it("does not confirm a day where any part of the deposit hadn't arrived", () => {
    const days = depositDaysToConfirm({
      payments: [pay("acc-cash", "2026-08-02"), pay("acc-bank", "2026-08-15")],
      confirmations: confirmed(settlementKey("acc-cash", "2026-09-10")),
      todayIso: TODAY,
    });
    expect(days).toEqual([]);
  });
});

describe("cardScanSince", () => {
  it("reaches back to the first of the previous month", () => {
    expect(cardScanSince("2026-09-17")).toBe("2026-08-01");
    expect(cardScanSince("2026-01-05")).toBe("2025-12-01");
  });
});

describe("isSettlementArrived", () => {
  const batch = { accountId: "acc-1", settlementDate: "2026-09-10" };

  it("is arrived only when that exact deposit is confirmed", () => {
    expect(isSettlementArrived(batch, confirmed(settlementKey("acc-1", "2026-09-10")), TODAY)).toBe(true);
    expect(isSettlementArrived(batch, confirmed(), TODAY)).toBe(false);
    // Same day, other account — a different deposit.
    expect(isSettlementArrived(batch, confirmed(settlementKey("acc-2", "2026-09-10")), TODAY)).toBe(false);
  });

  it("a deposit with no account has nothing to confirm against — it arrives on its date", () => {
    expect(isSettlementArrived({ accountId: null, settlementDate: "2026-09-10" }, confirmed(), TODAY)).toBe(true);
    expect(isSettlementArrived({ accountId: null, settlementDate: "2026-10-10" }, confirmed(), TODAY)).toBe(false);
  });

  it("before the migration, falls back to arriving on its date", () => {
    expect(isSettlementArrived(batch, NO_CONFIRMATIONS, TODAY)).toBe(true);
    expect(isSettlementArrived({ accountId: "acc-1", settlementDate: "2026-10-10" }, NO_CONFIRMATIONS, TODAY)).toBe(false);
  });
});

describe("loadSettlementConfirmations", () => {
  const client = (result: { data: unknown; error: unknown }) =>
    ({
      from: () => ({ select: () => Promise.resolve(result) }),
    }) as never;

  it("reads confirmed deposits into keys", async () => {
    const got = await loadSettlementConfirmations(
      client({ data: [{ account_id: "acc-1", settlement_date: "2026-09-10" }], error: null })
    );
    expect(got.available).toBe(true);
    expect(got.confirmed.has(settlementKey("acc-1", "2026-09-10"))).toBe(true);
  });

  it("an unreadable table falls back rather than hiding every deposit", async () => {
    const got = await loadSettlementConfirmations(client({ data: null, error: { message: "relation does not exist" } }));
    expect(got.available).toBe(false);
  });
});

describe("toSettlementItems — the board follows the confirmation", () => {
  const batches = groupSettlementBatches([
    { id: "a", accountId: "acc-1", paymentDate: "2026-08-03", dueDate: "2026-09-10", amount: 1000, label: "דוד לוי" },
    { id: "b", accountId: "acc-1", paymentDate: "2026-08-20", dueDate: "2026-09-10", amount: 500, label: "מאפיית לחם" },
  ]);

  it("a confirmed deposit has arrived", () => {
    const [row] = toSettlementItems(batches, TODAY, confirmed(settlementKey("acc-1", "2026-09-10")));
    expect(row.stage).toBe("posted");
    expect(row.overdue).toBe(false);
    expect(row.settlement?.arrived).toBe(true);
  });

  it("an unconfirmed deposit past its day is late, and says so", () => {
    const [row] = toSettlementItems(batches, TODAY, confirmed());
    expect(row.stage).toBe("pending");
    expect(row.overdue).toBe(true);
    expect(row.settlement?.arrived).toBe(false);
  });

  it("an unconfirmed deposit still ahead is just expected", () => {
    const future = groupSettlementBatches([
      { id: "c", accountId: "acc-1", paymentDate: "2026-09-03", dueDate: "2026-10-10", amount: 700 },
    ]);
    const [row] = toSettlementItems(future, TODAY, confirmed());
    expect(row.stage).toBe("scheduled");
    expect(row.overdue).toBe(false);
  });

  it("carries the payments it is made of, newest first, with who each was from", () => {
    const [row] = toSettlementItems(batches, TODAY, confirmed());
    expect(row.settlement?.payments.map((p) => p.label)).toEqual(["מאפיית לחם", "דוד לוי"]);
    expect(row.settlement?.payments.reduce((s, p) => s + p.amount, 0)).toBe(row.amount);
    expect(row.settlement?.accountId).toBe("acc-1");
    expect(row.settlement?.date).toBe("2026-09-10");
  });
});

describe("labelSettlementPayments", () => {
  function client(tables: Record<string, unknown[]>) {
    return {
      from: (table: string) => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.in = () => Promise.resolve({ data: tables[table] ?? [], error: null });
        return b;
      },
    } as never;
  }

  it("names a payment by its order's customer, then falls back to its note", async () => {
    const got = await labelSettlementPayments(
      client({
        orders: [{ id: "o1", customer_id: "c1" }],
        projects: [],
        customers: [{ id: "c1", name: "דוד לוי" }],
      }),
      [
        { id: "p1", paymentDate: "2026-09-01", amount: 100, orderId: "o1", projectId: null, notes: null },
        { id: "p2", paymentDate: "2026-09-05", amount: 200, orderId: null, projectId: null, notes: "מכירה בחנות" },
        { id: "p3", paymentDate: "2026-09-03", amount: 300, orderId: null, projectId: null, notes: null },
      ]
    );
    const byId = Object.fromEntries(got.map((p) => [p.id, p.label]));
    expect(byId.p1).toBe("דוד לוי");
    expect(byId.p2).toBe("מכירה בחנות");
    expect(byId.p3).toBe("תקבול אשראי");
    // Newest first.
    expect(got.map((p) => p.id)).toEqual(["p2", "p3", "p1"]);
  });
});
