import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/paginate";

// ════════════════════════════════════════════════════════════════════════════
// Per-credit-card cost, per month. Source of truth = the `expenses` table
// (payment_method='credit_card'); the card identity is the expense `category`
// (set to the card label on statement import, e.g. "ויזה כאל זהב 9557").
// Bucketed by PURCHASE date (transaction_date) when present — more accurate for
// "what did this card cost me" than the billing date — falling back to
// expense_date (billing) when there's no transaction date.
// ════════════════════════════════════════════════════════════════════════════

const FALLBACK_CARD = "כרטיס אשראי";

export type CardCostsMonth = {
  month: string; // YYYY-MM
  byCard: Record<string, number>;
  total: number;
};

export type CardExpenseItem = {
  month: string; // YYYY-MM (bucket month)
  card: string;
  date: string; // the bucket date (purchase date when available)
  description: string;
  amount: number;
};

export type CardCostsReport = {
  cards: Array<{ label: string }>; // cards with activity in the shown window, by total desc
  months: CardCostsMonth[]; // chronological
  totals: { byCard: Record<string, number>; grand: number };
  // Individual charges (within the shown window) so a month can be drilled open.
  items: CardExpenseItem[];
};

type Row = Record<string, unknown>;

function num(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function str(value: unknown) {
  return typeof value === "string" ? value : null;
}

export async function loadCardCostsByMonth(
  supabase: SupabaseClient,
  { monthsBack = 12 }: { monthsBack?: number } = {}
): Promise<CardCostsReport> {
  let cardRows: Row[];
  try {
    cardRows = await fetchAllPaged<Row>((lo, hi) =>
      supabase
        .from("expenses")
        .select("amount,category,expense_date,transaction_date,payment_method,description")
        .eq("payment_method", "credit_card")
        .range(lo, hi)
    );
  } catch {
    return { cards: [], months: [], totals: { byCard: {}, grand: 0 }, items: [] };
  }

  // month -> card -> total
  const acc = new Map<string, Map<string, number>>();
  const allItems: CardExpenseItem[] = [];
  for (const row of cardRows) {
    const card = str(row.category)?.trim() || FALLBACK_CARD;
    const date = str(row.transaction_date) || str(row.expense_date);
    if (!date) continue;
    const amount = Math.abs(num(row.amount));
    if (!amount) continue;
    const month = date.slice(0, 7);
    let byCard = acc.get(month);
    if (!byCard) {
      byCard = new Map();
      acc.set(month, byCard);
    }
    byCard.set(card, (byCard.get(card) ?? 0) + amount);
    allItems.push({
      month,
      card,
      date,
      description: str(row.description)?.trim() || card,
      amount,
    });
  }

  const monthList = Array.from(acc.keys()).sort();
  const shown = monthsBack > 0 ? monthList.slice(-monthsBack) : monthList;

  // Card totals over the shown window only, so the table reconciles.
  const cardTotals = new Map<string, number>();
  for (const month of shown) {
    for (const [card, value] of acc.get(month) ?? []) {
      cardTotals.set(card, (cardTotals.get(card) ?? 0) + value);
    }
  }
  const cards = Array.from(cardTotals.entries())
    .filter(([, total]) => total > 0.5)
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => ({ label }));
  const cardKeys = cards.map((c) => c.label);

  const months: CardCostsMonth[] = shown.map((month) => {
    const raw = acc.get(month) ?? new Map();
    const byCard: Record<string, number> = {};
    let total = 0;
    for (const key of cardKeys) {
      const value = raw.get(key) ?? 0;
      byCard[key] = value;
      total += value;
    }
    return { month, byCard, total };
  });

  const byCardTotal: Record<string, number> = {};
  let grand = 0;
  for (const key of cardKeys) {
    const total = cardTotals.get(key) ?? 0;
    byCardTotal[key] = total;
    grand += total;
  }

  const shownSet = new Set(shown);
  const items = allItems
    .filter((item) => shownSet.has(item.month))
    .sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);

  return { cards, months, totals: { byCard: byCardTotal, grand }, items };
}
