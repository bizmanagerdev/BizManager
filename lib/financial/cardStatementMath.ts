// The money of ONE credit-card statement, per card, and where the statement
// stands in its monthly steps (שיוך והוצאות → חיוב בבנק → סיום). Pure, shared
// by the statement page, the statements list and the reminder rule, so the
// three never disagree. Every sum runs in whole agorot: adding shekel floats
// is what stored charges like 15464.429999999997 (fixed 2026-10-13).
//
// Per card:  purchases − refunds = bill — what the card company takes from the bank
// in one line, so the bank charge recorded for the card should equal it.
// Left-out lines ("לא לתיעוד" — swiped for someone who paid us cash) are not
// expenses, but the bank still takes them, so they stay inside the bill.
// "countedTwice" = lines linked to an expense that carries its own bank account
// (typed by hand before the statement came, or given an account later): that
// expense leaves the account by itself AND inside the card's charge. Found
// 2026-10-13: ₪6,688.00 on הלר בית 8.26 and ₪210.00 on הלר עסקי 7.26.

export const GENERIC_CARD_LABEL = "כרטיס אשראי";

export type StatementMathRow = {
  id: string;
  /** Stable card identity (card_statement_rows.card_label). */
  cardLabel: string;
  /** Positive = purchase, negative = refund. */
  amount: number;
  include: boolean;
  /** The line's bank charge date. */
  expenseDate: string;
  businessDomain: string;
  expenseId: string | null;
  expenseExists: boolean;
  /** Bank account of the linked expense, when it was typed by hand with one. */
  expenseAccountId: string | null;
  incomePaymentId: string | null;
  incomeExists: boolean;
};

export type StatementMathCharge = {
  id: string;
  cardLabel: string;
  amount: number;
  chargeDate: string;
  accountId: string;
};

export type CardSummary = {
  label: string;
  lineCount: number;
  purchases: number;
  purchaseCount: number;
  refunds: number;
  refundCount: number;
  bill: number;
  /** Purchases left unticked ("לא לתיעוד"): not our expense, but inside the bill. */
  leftOut: number;
  leftOutCount: number;
  /** Refunds left unticked: the bill is already lower by them, yet no income records them. */
  refundsLeftOut: number;
  refundsLeftOutCount: number;
  /** Lines whose expense also leaves a bank account by itself — the bank balance counts them twice. */
  countedTwice: number;
  countedTwiceCount: number;
  /** Their expense ids, to move them into the card's charge. */
  countedTwiceExpenseIds: string[];
  /** The line count and sum per bank date — more than one when some lines were charged on their own day. */
  bankDates: Array<{ date: string; amount: number; count: number }>;
  /** The bank date most of the card's lines share. */
  usualDate: string;
  charge: StatementMathCharge | null;
  /** charge − bill, or null while no charge is recorded. */
  difference: number | null;
  needsCharge: boolean;
  /** Refunds at least as big as the purchases: nothing to charge this month. */
  creditBalance: boolean;
};

export type StatementSteps = {
  cards: CardSummary[];
  assign: {
    done: boolean;
    created: number;
    ready: number;
    needsDomain: number;
    leftOut: number;
    refundsLeftOut: number;
    refundsWaiting: number;
  };
  bank: { done: boolean; missingCards: string[] };
  canFinish: boolean;
  /** What still stops "סיום", in the words the page shows. */
  missing: string[];
  totals: { bill: number; charged: number; difference: number | null; countedTwice: number };
};

export const toAgorot = (shekels: number) => (Number.isFinite(shekels) ? Math.round(shekels * 100) : 0);
export const fromAgorot = (agorot: number) => agorot / 100;
/** A shekel amount rounded to the agora, safe to store. */
export const roundShekels = (shekels: number) => fromAgorot(toAgorot(shekels));

export function cardKeyOf(label: string | null | undefined): string {
  return (label ?? "").trim() || GENERIC_CARD_LABEL;
}

export type RowMode = "draft" | "created" | "deleted";

/** A purchase is done once it has an expense; a refund once it has its income. */
export function statementRowMode(row: Pick<StatementMathRow, "amount" | "expenseId" | "expenseExists" | "incomePaymentId" | "incomeExists">): RowMode {
  if (row.amount < 0) {
    if (row.incomeExists) return "created";
    if (row.incomePaymentId) return "deleted";
    return "draft";
  }
  if (row.expenseExists) return "created";
  if (row.expenseId) return "deleted";
  return "draft";
}

export function summarizeStatement(rows: StatementMathRow[], charges: StatementMathCharge[]): StatementSteps {
  type Acc = {
    lineCount: number;
    purchases: number;
    purchaseCount: number;
    refunds: number;
    refundCount: number;
    leftOut: number;
    leftOutCount: number;
    refundsLeftOut: number;
    refundsLeftOutCount: number;
    countedTwice: number;
    countedTwiceIds: string[];
    dates: Map<string, { amount: number; count: number }>;
  };
  const byCard = new Map<string, Acc>();
  let created = 0;
  let ready = 0;
  let needsDomain = 0;
  let leftOutRows = 0;
  let refundsLeftOutRows = 0;
  let refundsWaiting = 0;

  for (const row of rows) {
    const label = cardKeyOf(row.cardLabel);
    const acc =
      byCard.get(label) ??
      ({
        lineCount: 0,
        purchases: 0,
        purchaseCount: 0,
        refunds: 0,
        refundCount: 0,
        leftOut: 0,
        leftOutCount: 0,
        refundsLeftOut: 0,
        refundsLeftOutCount: 0,
        countedTwice: 0,
        countedTwiceIds: [] as string[],
        dates: new Map(),
      } satisfies Acc);
    byCard.set(label, acc);
    const ag = toAgorot(row.amount);
    acc.lineCount += 1;
    if (ag > 0) {
      acc.purchases += ag;
      acc.purchaseCount += 1;
    } else if (ag < 0) {
      acc.refunds += -ag;
      acc.refundCount += 1;
    }
    const date = (row.expenseDate ?? "").slice(0, 10);
    if (date) {
      const d = acc.dates.get(date) ?? { amount: 0, count: 0 };
      d.amount += ag;
      d.count += 1;
      acc.dates.set(date, d);
    }

    const mode = statementRowMode(row);
    if (ag > 0 && mode === "created" && row.expenseAccountId && row.expenseId) {
      acc.countedTwice += ag;
      acc.countedTwiceIds.push(row.expenseId);
    }
    if (ag === 0 || mode === "deleted") continue;
    if (mode === "created") {
      created += 1;
      continue;
    }
    if (!row.include) {
      if (ag > 0) {
        acc.leftOut += ag;
        acc.leftOutCount += 1;
        leftOutRows += 1;
      } else {
        acc.refundsLeftOut += -ag;
        acc.refundsLeftOutCount += 1;
        refundsLeftOutRows += 1;
      }
      continue;
    }
    if (row.businessDomain) ready += 1;
    else needsDomain += 1;
    if (ag < 0) refundsWaiting += 1;
  }

  const chargeByCard = new Map<string, StatementMathCharge>();
  for (const c of charges) chargeByCard.set(cardKeyOf(c.cardLabel), c);

  const cards: CardSummary[] = [...byCard.entries()].map(([label, acc]) => {
    const billAg = acc.purchases - acc.refunds;
    const charge = chargeByCard.get(label) ?? null;
    const bankDates = [...acc.dates.entries()]
      .map(([date, d]) => ({ date, amount: fromAgorot(d.amount), count: d.count }))
      .sort((a, b) => a.date.localeCompare(b.date));
    let usualDate = "";
    let usualCount = 0;
    for (const d of bankDates) {
      if (d.count > usualCount) {
        usualCount = d.count;
        usualDate = d.date;
      }
    }
    return {
      label,
      lineCount: acc.lineCount,
      purchases: fromAgorot(acc.purchases),
      purchaseCount: acc.purchaseCount,
      refunds: fromAgorot(acc.refunds),
      refundCount: acc.refundCount,
      bill: fromAgorot(billAg),
      leftOut: fromAgorot(acc.leftOut),
      leftOutCount: acc.leftOutCount,
      refundsLeftOut: fromAgorot(acc.refundsLeftOut),
      refundsLeftOutCount: acc.refundsLeftOutCount,
      countedTwice: fromAgorot(acc.countedTwice),
      countedTwiceCount: acc.countedTwiceIds.length,
      countedTwiceExpenseIds: acc.countedTwiceIds,
      bankDates,
      usualDate,
      charge,
      difference: charge ? fromAgorot(toAgorot(charge.amount) - billAg) : null,
      needsCharge: !charge && billAg > 0,
      creditBalance: billAg <= 0,
    };
  });
  // A card charged on this statement whose lines all moved to another card still shows,
  // so its charge can be seen and deleted.
  for (const [label, charge] of chargeByCard) {
    if (byCard.has(label)) continue;
    cards.push({
      label,
      lineCount: 0,
      purchases: 0,
      purchaseCount: 0,
      refunds: 0,
      refundCount: 0,
      bill: 0,
      leftOut: 0,
      leftOutCount: 0,
      refundsLeftOut: 0,
      refundsLeftOutCount: 0,
      countedTwice: 0,
      countedTwiceCount: 0,
      countedTwiceExpenseIds: [],
      bankDates: [],
      usualDate: "",
      charge,
      difference: roundShekels(charge.amount),
      needsCharge: false,
      creditBalance: false,
    });
  }
  cards.sort((a, b) => a.label.localeCompare(b.label, "he"));

  const missingCards = cards.filter((c) => c.needsCharge).map((c) => c.label);
  const assignDone = ready + needsDomain === 0;
  const missing: string[] = [];
  if (needsDomain > 0) missing.push(`${needsDomain} שורות בלי תחום`);
  if (ready > 0) missing.push(`${ready} שורות שעוד לא נרשמו`);
  for (const label of missingCards) missing.push(`חיוב בנק: ${label}`);

  const sum = (pick: (c: CardSummary) => number) => fromAgorot(cards.reduce((s, c) => s + toAgorot(pick(c)), 0));
  const charged = cards.filter((c) => c.charge);
  const allCharged = cards.length > 0 && cards.every((c) => c.charge || !c.needsCharge);
  return {
    cards,
    assign: { done: assignDone, created, ready, needsDomain, leftOut: leftOutRows, refundsLeftOut: refundsLeftOutRows, refundsWaiting },
    bank: { done: missingCards.length === 0, missingCards },
    canFinish: assignDone && missingCards.length === 0,
    missing,
    totals: {
      bill: sum((c) => c.bill),
      countedTwice: sum((c) => c.countedTwice),
      charged: fromAgorot(charged.reduce((s, c) => s + toAgorot(c.charge!.amount), 0)),
      difference:
        allCharged && charged.length > 0
          ? fromAgorot(cards.reduce((s, c) => s + (c.difference === null ? 0 : toAgorot(c.difference)), 0))
          : null,
    },
  };
}
