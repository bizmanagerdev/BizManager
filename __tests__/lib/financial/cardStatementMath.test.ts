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
