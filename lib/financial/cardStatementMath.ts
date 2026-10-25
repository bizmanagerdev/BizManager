// The money of ONE credit-card statement, per card, and where the statement
// stands in its monthly steps (שיוך והוצאות → חיוב בבנק → סיום). Pure, shared
// by the statement page, the statements list and the reminder rule, so the
// three never disagree. Every sum runs in whole agorot: adding shekel floats
// is what stored charges like 15464.429999999997 (fixed 2026-10-13).
//
// Per card:  purchases − refunds = bill — what the card company takes from the bank
// in one line, so the bank charge recorded for the card should equal it.
// Left-out lines ("לא לתיעוד" — swiped for someone who paid us cash) are not
// expenses, but the bank still takes them, so they stay inside the bill. A
// "מול מזומן" line is a left-out line whose cash was also put in the cash box
// (an account_transfers row with no "from" — its OUT side is the card charge).
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
  /** "מול מזומן": the cash entry this purchase put in the cash box. On a US
   *  card's statement, also a cash advance's transfer into the cash box. */
  cashTransferId?: string | null;
  /** A US card's line (card_statement_rows.line_kind): "charge" (every Israeli
   *  line), "payment" (paying the card) or "cash_advance". */
  lineKind?: "charge" | "payment" | "cash_advance";
  /** A payment line's transfer from the bank into the card, once linked. */
  paymentTransferId?: string | null;
};

/** A statement kept on a US card's own account (2026-10-25): its lines are
 *  expenses on that account, its payments transfers — no lump bank charge. */
export type StatementMathOptions = { cardAccountId?: string | null };

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
  /** "מול מזומן" purchases: inside the bill, not expenses, their cash in the cash box. */
  cash: number;
  cashCount: number;
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
  /** A US card's payments on this statement (as a positive sum) — never in the bill. */
  payments: number;
  paymentCount: number;
};

export type StatementSteps = {
  /** "bank_charge": an Israeli card, one charge a month from a bank.
   *  "card_account": a US card kept as its own account. */
  mode: "bank_charge" | "card_account";
  cards: CardSummary[];
  assign: {
    done: boolean;
    created: number;
    ready: number;
    needsDomain: number;
    leftOut: number;
    refundsLeftOut: number;
    refundsWaiting: number;
    cash: number;
  };
  bank: { done: boolean; missingCards: string[] };
  /** A US card's payments and cash advances: linked to their transfer, or waiting. */
  transfers: { done: boolean; paymentsLinked: number; paymentsWaiting: number; advancesWaiting: number };
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

/** payment = a US card's payment line not yet linked to its transfer, paid =
 *  linked; advance = a cash advance not yet in the cash box. */
export type RowMode = "draft" | "created" | "deleted" | "cash" | "payment" | "paid" | "advance";

/** A purchase is done once it has an expense, or once it is "מול מזומן"; a refund once it has its income. */
export function statementRowMode(
  row: Pick<
    StatementMathRow,
    "amount" | "expenseId" | "expenseExists" | "incomePaymentId" | "incomeExists" | "cashTransferId" | "lineKind" | "paymentTransferId"
  >
): RowMode {
  if (row.lineKind === "payment") return row.paymentTransferId ? "paid" : "payment";
  if (row.lineKind === "cash_advance") return row.cashTransferId ? "cash" : "advance";
  if (row.amount < 0) {
    if (row.incomeExists) return "created";
    if (row.incomePaymentId) return "deleted";
    return "draft";
  }
  if (row.expenseExists) return "created";
  if (row.cashTransferId) return "cash";
  if (row.expenseId) return "deleted";
  return "draft";
}

export function summarizeStatement(
  rows: StatementMathRow[],
  charges: StatementMathCharge[],
  options: StatementMathOptions = {}
): StatementSteps {
  // A US card's own account: its lines are expenses on it (never "counted
  // twice"), its payments are transfers, and no bank charge is recorded.
  const cardAccountId = options.cardAccountId ?? null;
  const cardMode = Boolean(cardAccountId);
  let paymentsLinked = 0;
  let paymentsWaiting = 0;
  let advancesWaiting = 0;
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
    cash: number;
    cashCount: number;
    countedTwice: number;
    countedTwiceIds: string[];
    dates: Map<string, { amount: number; count: number }>;
    payments: number;
    paymentCount: number;
  };
  const byCard = new Map<string, Acc>();
  let created = 0;
  let ready = 0;
  let needsDomain = 0;
  let leftOutRows = 0;
  let refundsLeftOutRows = 0;
  let refundsWaiting = 0;
  let cashRows = 0;

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
        cash: 0,
        cashCount: 0,
        countedTwice: 0,
        countedTwiceIds: [] as string[],
        dates: new Map(),
        payments: 0,
        paymentCount: 0,
      } satisfies Acc);
    byCard.set(label, acc);
    const ag = toAgorot(row.amount);
    acc.lineCount += 1;
    // Paying the card: a transfer from the bank, never a purchase or a refund.
    if (row.lineKind === "payment") {
      acc.payments += -ag;
      acc.paymentCount += 1;
      if (statementRowMode(row) === "paid") paymentsLinked += 1;
      else paymentsWaiting += 1;
      continue;
    }
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
    if (ag > 0 && mode === "created" && row.expenseAccountId && row.expenseId && row.expenseAccountId !== cardAccountId) {
      acc.countedTwice += ag;
      acc.countedTwiceIds.push(row.expenseId);
    }
    if (mode === "advance") {
      advancesWaiting += 1;
      continue;
    }
    if (ag === 0 || mode === "deleted") continue;
    if (mode === "created") {
      created += 1;
      continue;
    }
    if (mode === "cash") {
      acc.cash += ag;
      acc.cashCount += 1;
      cashRows += 1;
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
      cash: fromAgorot(acc.cash),
      cashCount: acc.cashCount,
      countedTwice: fromAgorot(acc.countedTwice),
      countedTwiceCount: acc.countedTwiceIds.length,
      countedTwiceExpenseIds: acc.countedTwiceIds,
      bankDates,
      usualDate,
      charge,
      difference: charge ? fromAgorot(toAgorot(charge.amount) - billAg) : null,
      needsCharge: !cardMode && !charge && billAg > 0,
      creditBalance: billAg <= 0,
      payments: fromAgorot(acc.payments),
      paymentCount: acc.paymentCount,
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
      cash: 0,
      cashCount: 0,
      countedTwice: 0,
      countedTwiceCount: 0,
      countedTwiceExpenseIds: [],
      bankDates: [],
      usualDate: "",
      charge,
      difference: roundShekels(charge.amount),
      needsCharge: false,
      creditBalance: false,
      payments: 0,
      paymentCount: 0,
    });
  }
  cards.sort((a, b) => a.label.localeCompare(b.label, "he"));

  const missingCards = cards.filter((c) => c.needsCharge).map((c) => c.label);
  const assignDone = ready + needsDomain === 0;
  const missing: string[] = [];
  if (needsDomain > 0) missing.push(`${needsDomain} שורות בלי תחום`);
  if (ready > 0) missing.push(`${ready} שורות שעוד לא נרשמו`);
  for (const label of missingCards) missing.push(`חיוב בנק: ${label}`);
  if (paymentsWaiting > 0) {
    missing.push(paymentsWaiting === 1 ? "תשלום לכרטיס שלא קושר להעברה" : `${paymentsWaiting} תשלומים לכרטיס שלא קושרו להעברה`);
  }
  if (advancesWaiting > 0) {
    missing.push(advancesWaiting === 1 ? "משיכת מזומן שלא נרשמה" : `${advancesWaiting} משיכות מזומן שלא נרשמו`);
  }
  const transfersDone = paymentsWaiting === 0 && advancesWaiting === 0;

  const sum = (pick: (c: CardSummary) => number) => fromAgorot(cards.reduce((s, c) => s + toAgorot(pick(c)), 0));
  const charged = cards.filter((c) => c.charge);
  const allCharged = cards.length > 0 && cards.every((c) => c.charge || !c.needsCharge);
  return {
    mode: cardMode ? "card_account" : "bank_charge",
    cards,
    assign: { done: assignDone, created, ready, needsDomain, leftOut: leftOutRows, refundsLeftOut: refundsLeftOutRows, refundsWaiting, cash: cashRows },
    // On a US card the middle step is its payments, not a bank charge.
    bank: { done: cardMode ? transfersDone : missingCards.length === 0, missingCards },
    transfers: { done: transfersDone, paymentsLinked, paymentsWaiting, advancesWaiting },
    canFinish: assignDone && missingCards.length === 0 && transfersDone,
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
