import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/paginate";
import { cardKeyOf, fromAgorot, toAgorot } from "@/lib/financial/cardStatementMath";

// ════════════════════════════════════════════════════════════════════════════
// What each credit card cost, month by month — one statement per card per month.
// A cell is the card's whole statement: the bank charge recorded for it, or (until
// that's recorded) its lines' bill, purchases − refunds. It is never spread over
// the purchase dates (owner, 2026-10-13: "we're going to put the total of the
// statement").
//
// The month a statement sits in is the statement's own month — the month most of
// the file's purchases were made, the same month as its file name ("הלר בית 9.26":
// bought in September, charged on 2/10 → 09/26). Decided per file, not per card: a
// card with a few lines bought on the 1st of the next month (Diners on הלר עסקי
// 8.26) stays with its statement. Mercantile charges on the 27th of the same
// month, and lands in that month too.
//
// From July 2026 by default: that's when everything started being entered into
// the system in full (owner, 2026-10-13); earlier months are one tap away.
//
// Card purchases typed by hand that are on no statement (a card whose statements
// aren't uploaded yet, like Chase) are listed apart instead of becoming made-up
// card columns; card-clearing fees ("עמלה") aren't a card's spending and stay out.
// ════════════════════════════════════════════════════════════════════════════

export const FULL_BOOKS_FROM = "2026-07";
const FEE_CATEGORY = "עמלה";

export type CardMonthCell = {
  statementId: string;
  statementName: string;
  /** The bank charge, or the lines' bill until the charge is recorded. */
  amount: number;
  charged: boolean;
  /** When the bank took it (the recorded charge's date, else the lines' bank date). */
  bankDate: string;
  lineCount: number;
  purchases: number;
  refunds: number;
  /** Purchases left unticked ("לא לתיעוד") — inside the bank charge, not our expense. */
  leftOut: number;
  /** What it was spent on: the ticked lines per business domain, refunds netted. */
  byDomain: Array<{ domain: string; amount: number }>;
};

export type CardMonth = {
  month: string; // YYYY-MM — the statement's own month
  cells: Record<string, CardMonthCell[]>; // card → its statement(s) that month
  total: number;
};

export type UnlistedCardExpense = {
  id: string;
  date: string;
  description: string;
  amount: number;
  accountName: string | null;
  domain: string | null;
};

export type CardCostsReport = {
  cards: string[]; // by total, largest first
  months: CardMonth[]; // newest first
  fullFrom: string;
  /** Hand-typed card purchases on no statement, from fullFrom. */
  unlisted: UnlistedCardExpense[];
};

export type CardLine = {
  statementId: string;
  cardLabel: string;
  amount: number;
  include: boolean;
  expenseDate: string;
  transactionDate: string;
  businessDomain: string;
};

export type CardCharge = { statementId: string; cardLabel: string; amount: number; chargeDate: string };

/** Pure: one cell per statement × card, placed in the statement's own month. */
export function buildCardMonths(
  lines: CardLine[],
  charges: CardCharge[],
  statementNames: Record<string, string>
): Pick<CardCostsReport, "cards" | "months"> {
  type Acc = {
    statementId: string;
    card: string;
    lineCount: number;
    billAg: number;
    purchasesAg: number;
    refundsAg: number;
    leftOutAg: number;
    bankDates: Map<string, number>;
    domains: Map<string, number>;
  };
  const groups = new Map<string, Acc>();
  // statement → purchase month → line count, for the statement's own month.
  const statementMonths = new Map<string, Map<string, number>>();
  for (const line of lines) {
    const card = cardKeyOf(line.cardLabel);
    const key = `${line.statementId} ${card}`;
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        statementId: line.statementId,
        card,
        lineCount: 0,
        billAg: 0,
        purchasesAg: 0,
        refundsAg: 0,
        leftOutAg: 0,
        bankDates: new Map(),
        domains: new Map(),
      };
      groups.set(key, acc);
    }
    const ag = toAgorot(line.amount);
    acc.lineCount += 1;
    acc.billAg += ag;
    if (ag > 0) acc.purchasesAg += ag;
    else acc.refundsAg += -ag;
    const bought = (line.transactionDate || line.expenseDate).slice(0, 7);
    if (bought) {
      const counts = statementMonths.get(line.statementId) ?? new Map<string, number>();
      counts.set(bought, (counts.get(bought) ?? 0) + 1);
      statementMonths.set(line.statementId, counts);
    }
    const bank = line.expenseDate.slice(0, 10);
    if (bank) acc.bankDates.set(bank, (acc.bankDates.get(bank) ?? 0) + 1);
    if (!line.include) {
      if (ag > 0) acc.leftOutAg += ag;
    } else if (line.businessDomain) {
      acc.domains.set(line.businessDomain, (acc.domains.get(line.businessDomain) ?? 0) + ag);
    }
  }

  const chargeFor = new Map<string, CardCharge>();
  for (const c of charges) chargeFor.set(`${c.statementId} ${cardKeyOf(c.cardLabel)}`, c);
  const mostOf = (counts: Map<string, number>) => {
    let best = "";
    let bestCount = 0;
    for (const [value, count] of counts) {
      // Ties go to the later value — a statement's own month over a stray installment's.
      if (count > bestCount || (count === bestCount && value > best)) {
        best = value;
        bestCount = count;
      }
    }
    return best;
  };

  const byMonth = new Map<string, CardMonth>();
  const cardTotals = new Map<string, number>();
  for (const [key, acc] of groups) {
    const month = mostOf(statementMonths.get(acc.statementId) ?? new Map());
    if (!month) continue;
    const charge = chargeFor.get(key);
    const amountAg = charge ? toAgorot(charge.amount) : acc.billAg;
    const cell: CardMonthCell = {
      statementId: acc.statementId,
      statementName: statementNames[acc.statementId] ?? "",
      amount: fromAgorot(amountAg),
      charged: Boolean(charge),
      bankDate: charge?.chargeDate.slice(0, 10) || mostOf(acc.bankDates),
      lineCount: acc.lineCount,
      purchases: fromAgorot(acc.purchasesAg),
      refunds: fromAgorot(acc.refundsAg),
      leftOut: fromAgorot(acc.leftOutAg),
      byDomain: [...acc.domains.entries()]
        .filter(([, ag]) => ag !== 0)
        .sort((a, b) => b[1] - a[1])
        .map(([domain, ag]) => ({ domain, amount: fromAgorot(ag) })),
    };
    const row = byMonth.get(month) ?? { month, cells: {}, total: 0 };
    (row.cells[acc.card] ??= []).push(cell);
    row.total = fromAgorot(toAgorot(row.total) + amountAg);
    byMonth.set(month, row);
    cardTotals.set(acc.card, (cardTotals.get(acc.card) ?? 0) + amountAg);
  }

  return {
    cards: [...cardTotals.entries()].sort((a, b) => b[1] - a[1]).map(([card]) => card),
    months: [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)),
  };
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const one = (v: unknown): Row | null => ((Array.isArray(v) ? v[0] : v) as Row | null | undefined) ?? null;

export async function loadCardCostsByMonth(supabase: SupabaseClient): Promise<CardCostsReport> {
  const empty: CardCostsReport = { cards: [], months: [], fullFrom: FULL_BOOKS_FROM, unlisted: [] };
  let rows: Row[];
  let chargeRows: Row[];
  let statementRows: Row[];
  try {
    [rows, chargeRows, statementRows] = await Promise.all([
      fetchAllPaged<Row>((lo, hi) =>
        supabase
          .from("card_statement_rows")
          .select(
            "statement_id,card_label,category,amount,include,expense_date,transaction_date,business_domain,expense_id,expense:expenses(amount,business_domain)"
          )
          .order("id")
          .range(lo, hi)
      ),
      fetchAllPaged<Row>((lo, hi) =>
        supabase.from("card_statement_charges").select("statement_id,card_label,amount,charge_date").order("id").range(lo, hi)
      ),
      fetchAllPaged<Row>((lo, hi) => supabase.from("card_statements").select("id,file_name,card_account_id").order("id").range(lo, hi)),
    ]);
  } catch {
    return empty;
  }

  // A US card kept as its own account (2026-10-25) is in dollars and has no
  // bank charge: it stays out of this table of shekel charges — its page is its
  // account's register. Its lines' expenses are still linked, so none of them
  // shows as "unlisted" below.
  const onCardAccount = new Set(statementRows.filter((s) => str(s.card_account_id)).map((s) => str(s.id)));
  const linkedExpenses = new Set<string>();
  for (const r of rows) if (onCardAccount.has(str(r.statement_id)) && str(r.expense_id)) linkedExpenses.add(str(r.expense_id));
  const lines: CardLine[] = rows.filter((r) => !onCardAccount.has(str(r.statement_id))).map((r) => {
    // The live expense wins over the import snapshot, as on the statement page.
    const live = str(r.expense_id) ? one(r.expense) : null;
    if (str(r.expense_id)) linkedExpenses.add(str(r.expense_id));
    return {
      statementId: str(r.statement_id),
      cardLabel: str(r.card_label) || str(r.category),
      amount: num(live?.amount ?? r.amount),
      include: r.include !== false,
      expenseDate: str(r.expense_date).slice(0, 10),
      transactionDate: str(r.transaction_date).slice(0, 10),
      businessDomain: str(live?.business_domain ?? r.business_domain),
    };
  });
  const charges: CardCharge[] = chargeRows.map((c) => ({
    statementId: str(c.statement_id),
    cardLabel: str(c.card_label),
    amount: num(c.amount),
    chargeDate: str(c.charge_date),
  }));
  const names: Record<string, string> = {};
  for (const s of statementRows) names[str(s.id)] = str(s.file_name).replace(/\.(xlsx?|csv|pdf)$/i, "");

  // Hand-typed card purchases that no statement line points at.
  let unlisted: UnlistedCardExpense[] = [];
  try {
    const manual = await fetchAllPaged<Row>((lo, hi) =>
      supabase
        .from("expenses")
        .select("id,amount,category,description,expense_date,transaction_date,business_domain,account:accounts(name)")
        .eq("payment_method", "credit_card")
        .gte("expense_date", `${FULL_BOOKS_FROM}-01`)
        .order("id")
        .range(lo, hi)
    );
    unlisted = manual
      .filter((e) => !linkedExpenses.has(str(e.id)) && str(e.category).trim() !== FEE_CATEGORY)
      .map((e) => ({
        id: str(e.id),
        date: (str(e.transaction_date) || str(e.expense_date)).slice(0, 10),
        description: str(e.description).trim() || str(e.category).trim() || "—",
        amount: num(e.amount),
        accountName: str(one(e.account)?.name) || null,
        domain: str(e.business_domain) || null,
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);
  } catch {
    /* the table above still stands without this list */
  }

  return { ...buildCardMonths(lines, charges, names), fullFrom: FULL_BOOKS_FROM, unlisted };
}
