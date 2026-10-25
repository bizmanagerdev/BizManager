import { describe, it, expect } from "vitest";
import {
  summarizeStatement,
  statementRowMode,
  roundShekels,
  type StatementMathRow,
  type StatementMathCharge,
} from "@/lib/financial/cardStatementMath";

let seq = 0;
function row(over: Partial<StatementMathRow> & Pick<StatementMathRow, "cardLabel" | "amount">): StatementMathRow {
  seq += 1;
  return {
    id: `r${seq}`,
    include: true,
    expenseDate: "2026-10-02",
    businessDomain: "home",
    expenseId: null,
    expenseExists: false,
    expenseAccountId: null,
    incomePaymentId: null,
    incomeExists: false,
    ...over,
  };
}
const created = { expenseId: "e", expenseExists: true };
const charge = (cardLabel: string, amount: number, chargeDate = "2026-10-02"): StatementMathCharge => ({
  id: `c-${cardLabel}`,
  cardLabel,
  amount,
  chargeDate,
  accountId: "mizrahi-home",
});

describe("summarizeStatement — the bill per card", () => {
  // The shape of הלר בית 9.26 (uploaded 2026-10-13), card 9828: purchases ₪20,902.10
  // (one of them, ₪1,180.00, left out), refunds ₪8.40 + ₪1,257.66.
  const visa9828 = "ויזה כאל זהב 9828";
  const rows = [
    row({ cardLabel: visa9828, amount: 19722.1, ...created }),
    row({ cardLabel: visa9828, amount: 1180, include: false }),
    row({ cardLabel: visa9828, amount: -8.4 }),
    row({ cardLabel: visa9828, amount: -1257.66 }),
  ];

  it("bill = purchases − refunds, left-out lines stay in the bill", () => {
    const [card] = summarizeStatement(rows, []).cards;
    expect(card.purchases).toBe(20902.1);
    expect(card.refunds).toBe(1266.06);
    expect(card.bill).toBe(19636.04);
    expect(card.leftOut).toBe(1180);
    expect(card.countedTwice).toBe(0);
    expect(card.needsCharge).toBe(true);
  });

  it("refund lines wait for their income in the assign step", () => {
    const steps = summarizeStatement(rows, []);
    expect(steps.assign.refundsWaiting).toBe(2);
    expect(steps.assign.ready).toBe(2);
    expect(steps.assign.done).toBe(false);
    expect(steps.canFinish).toBe(false);
    expect(steps.missing).toEqual(["2 שורות שעוד לא נרשמו", `חיוב בנק: ${visa9828}`]);
  });

  it("is done once the refunds have income and the card has its bank charge", () => {
    const done = rows.map((r) => (r.amount < 0 ? { ...r, incomePaymentId: "p", incomeExists: true } : r));
    const steps = summarizeStatement(done, [charge(visa9828, 19636.04)]);
    expect(steps.assign.done).toBe(true);
    expect(steps.bank.done).toBe(true);
    expect(steps.canFinish).toBe(true);
    expect(steps.cards[0].difference).toBe(0);
    expect(steps.totals).toEqual({ bill: 19636.04, charged: 19636.04, difference: 0, countedTwice: 0 });
  });

  it("adds in agorot, never in floats", () => {
    const cents = Array.from({ length: 10 }, () => row({ cardLabel: "X 1111", amount: 0.1 }));
    expect(summarizeStatement(cents, []).cards[0].bill).toBe(1);
    expect(roundShekels(15464.429999999997)).toBe(15464.43);
  });
});

describe("summarizeStatement — lines whose expense also has its own bank account", () => {
  it("reports them as counted twice; the bank charge is still checked against the whole bill (הלר עסקי 7.26, card 7372)", () => {
    const card = "ויזה כאל עסקי 7372";
    const rows = [
      row({ cardLabel: card, amount: 16441.94, expenseDate: "2026-08-02", ...created }),
      row({ cardLabel: card, amount: -4, include: false, expenseDate: "2026-08-02" }),
      row({ cardLabel: card, amount: 5886, expenseDate: "2026-07-30", expenseId: "e1", expenseExists: true, expenseAccountId: "mizrahi-business" }),
      row({ cardLabel: card, amount: 663, expenseDate: "2026-08-02", expenseId: "e2", expenseExists: true, expenseAccountId: "mizrahi-business" }),
      row({ cardLabel: card, amount: 700, expenseDate: "2026-08-02", expenseId: "e3", expenseExists: true, expenseAccountId: "mizrahi-business" }),
    ];
    const steps = summarizeStatement(rows, [charge(card, 16437.94, "2026-08-02")]);
    const [summary] = steps.cards;
    expect(summary.bill).toBe(23686.94);
    expect(summary.countedTwice).toBe(7249);
    expect(summary.countedTwiceExpenseIds).toEqual(["e1", "e2", "e3"]);
    expect(summary.difference).toBe(-7249);
    expect(steps.totals.countedTwice).toBe(7249);
    expect(summary.bankDates.map((d) => d.date)).toEqual(["2026-07-30", "2026-08-02"]);
    expect(summary.usualDate).toBe("2026-08-02");
  });
});

describe("summarizeStatement — a bank charge that differs from the lines", () => {
  it("reports the difference (הלר בית 7.26, card 9557)", () => {
    const card = "ויזה כאל זהב 9557";
    const rows = [row({ cardLabel: card, amount: 18843.27, ...created })];
    const steps = summarizeStatement(rows, [charge(card, 19878)]);
    expect(steps.cards[0].difference).toBe(1034.73);
    expect(steps.totals.difference).toBe(1034.73);
    // A difference never blocks the finish.
    expect(steps.canFinish).toBe(true);
  });

  it("needs no charge when the refunds cover the purchases", () => {
    const rows = [row({ cardLabel: "X 2222", amount: 50, ...created }), row({ cardLabel: "X 2222", amount: -80, include: false })];
    const steps = summarizeStatement(rows, []);
    const [card] = steps.cards;
    expect(card.creditBalance).toBe(true);
    expect(card.needsCharge).toBe(false);
    // An unticked refund is not "לא לתיעוד": it is kept apart from left-out purchases.
    expect(card.leftOut).toBe(0);
    expect(card.refundsLeftOut).toBe(80);
    expect(steps.assign.refundsLeftOut).toBe(1);
    expect(steps.assign.leftOut).toBe(0);
  });

  it("files lines with no card under the generic label", () => {
    const steps = summarizeStatement([row({ cardLabel: "", amount: 10, ...created })], []);
    expect(steps.cards[0].label).toBe("כרטיס אשראי");
    expect(steps.bank.missingCards).toEqual(["כרטיס אשראי"]);
  });
});

describe("summarizeStatement — \"מול מזומן\" lines", () => {
  // The owner's example (2026-10-15): the bank took ₪4,000 for the card; ₪3,000 were
  // ours, ₪1,000 was swiped for someone who paid us cash.
  const card = "ויזה 9557";
  const rows = [
    row({ cardLabel: card, amount: 3000, ...created }),
    row({ cardLabel: card, amount: 1000, include: false, cashTransferId: "t1" }),
  ];
  const steps = summarizeStatement(rows, [charge(card, 4000)]);
  const [summary] = steps.cards;

  it("stays inside the bill, so the charge still matches the bank", () => {
    expect(summary.bill).toBe(4000);
    expect(summary.difference).toBe(0);
  });

  it("is counted as cash, not as a left-out line, and doesn't hold up the steps", () => {
    expect(summary.cash).toBe(1000);
    expect(summary.cashCount).toBe(1);
    expect(summary.leftOut).toBe(0);
    expect(steps.assign).toMatchObject({ created: 1, cash: 1, leftOut: 0, ready: 0, needsDomain: 0 });
    expect(steps.canFinish).toBe(true);
  });
});

describe("statementRowMode", () => {
  it("a purchase with a cash entry is \"cash\"; its expense, if any, still wins", () => {
    const base = { amount: 5, expenseId: null, expenseExists: false, incomePaymentId: null, incomeExists: false };
    expect(statementRowMode({ ...base, cashTransferId: "t" })).toBe("cash");
    expect(statementRowMode({ ...base, expenseId: "e", expenseExists: true, cashTransferId: "t" })).toBe("created");
    expect(statementRowMode({ ...base, amount: -5, cashTransferId: "t" })).toBe("draft");
  });

  it("a refund is done by its income, a purchase by its expense", () => {
    expect(statementRowMode({ amount: -5, expenseId: null, expenseExists: false, incomePaymentId: "p", incomeExists: true })).toBe("created");
    expect(statementRowMode({ amount: -5, expenseId: null, expenseExists: false, incomePaymentId: "p", incomeExists: false })).toBe("deleted");
    expect(statementRowMode({ amount: 5, expenseId: null, expenseExists: false, incomePaymentId: "p", incomeExists: true })).toBe("draft");
    expect(statementRowMode({ amount: 5, expenseId: "e", expenseExists: false, incomePaymentId: null, incomeExists: false })).toBe("deleted");
  });
});

describe("summarizeStatement — a US card kept as its own account (2026-10-25)", () => {
  // The shape of the Venture X statement for 25/07–24/08: three payments from
  // Capital One, purchases and a refund, all in dollars on the card's account.
  const card = "Venture X 9738";
  const opts = { cardAccountId: "venture-x" };
  const lines = () => [
    row({ cardLabel: card, amount: 1705, expenseId: "e1", expenseExists: true, expenseAccountId: "venture-x" }),
    row({ cardLabel: card, amount: 23.43 }),
    row({ cardLabel: card, amount: -4.5 }),
    row({ cardLabel: card, amount: -3100, lineKind: "payment", paymentTransferId: "t1" }),
    row({ cardLabel: card, amount: -46, lineKind: "payment" }),
  ];

  it("payments are kept apart from the bill, and no bank charge is asked for", () => {
    const steps = summarizeStatement(lines(), [], opts);
    expect(steps.mode).toBe("card_account");
    const [c] = steps.cards;
    expect(c.purchases).toBe(1728.43);
    expect(c.refunds).toBe(4.5);
    expect(c.bill).toBe(1723.93);
    expect([c.payments, c.paymentCount]).toEqual([3146, 2]);
    expect(c.needsCharge).toBe(false);
    expect(steps.bank.missingCards).toEqual([]);
  });

  it("an expense on the card's own account isn't counted twice", () => {
    const [c] = summarizeStatement(lines(), [], opts).cards;
    expect(c.countedTwice).toBe(0);
    // The same line on an Israeli statement (no card account) still is.
    const [israeli] = summarizeStatement(lines().filter((l) => l.lineKind !== "payment"), []).cards;
    expect(israeli.countedTwice).toBe(1705);
  });

  it("the middle step is the payments: each linked to its transfer before the statement can finish", () => {
    const steps = summarizeStatement(lines(), [], opts);
    expect(steps.transfers).toEqual({ done: false, paymentsLinked: 1, paymentsWaiting: 1, advancesWaiting: 0 });
    expect(steps.bank.done).toBe(false);
    expect(steps.missing).toContain("תשלום לכרטיס שלא קושר להעברה");
    // Payments never wait in the assign step.
    expect(steps.assign).toMatchObject({ created: 1, ready: 2, refundsWaiting: 1 });

    const linked = lines().map((l) => (l.lineKind === "payment" ? { ...l, paymentTransferId: "t" } : l));
    expect(summarizeStatement(linked, [], opts).transfers.done).toBe(true);
  });

  it("a cash advance waits until it is in the cash box", () => {
    const advance = row({ cardLabel: card, amount: 602.95, lineKind: "cash_advance" });
    const waiting = summarizeStatement([advance], [], opts);
    expect(waiting.transfers.advancesWaiting).toBe(1);
    expect(waiting.missing).toContain("משיכת מזומן שלא נרשמה");
    expect(waiting.cards[0].purchases).toBe(602.95);
    const done = summarizeStatement([{ ...advance, cashTransferId: "t" }], [], opts);
    expect(done.transfers.done).toBe(true);
    expect(done.assign.cash).toBe(1);
  });
});

describe("statementRowMode — a US card's payment and cash lines", () => {
  const base = { amount: -100, expenseId: null, expenseExists: false, incomePaymentId: null, incomeExists: false };
  it("a payment is waiting until linked, then paid — never a refund", () => {
    expect(statementRowMode({ ...base, lineKind: "payment" })).toBe("payment");
    expect(statementRowMode({ ...base, lineKind: "payment", paymentTransferId: "t" })).toBe("paid");
  });
  it("a cash advance is an advance until its cash is in", () => {
    expect(statementRowMode({ ...base, amount: 50, lineKind: "cash_advance" })).toBe("advance");
    expect(statementRowMode({ ...base, amount: 50, lineKind: "cash_advance", cashTransferId: "t" })).toBe("cash");
  });
});
