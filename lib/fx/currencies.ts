/**
 * The currencies money can be in (owner, 2026-10-22: the Chase account in the
 * States, the Canada buildings). Shekels are the books' own currency — every
 * total is in ₪ — and the others are turned into shekels at the Bank of
 * Israel's rate (lib/fx/rates.ts).
 *
 * A money row keeps its shekel amount in its usual column, and beside it the
 * amount as typed and its day's rate (supabase/migrations/
 * 20261023120000_money_currency.sql). `readForeignMoney` reads those.
 */

export const FOREIGN_CURRENCIES = ["USD", "CAD"] as const;

export type ForeignCurrency = (typeof FOREIGN_CURRENCIES)[number];

export type CurrencyCode = "ILS" | ForeignCurrency;

export function isForeignCurrency(value: unknown): value is ForeignCurrency {
  return (FOREIGN_CURRENCIES as readonly unknown[]).includes(value);
}

/** What goes before the number: "$1,000", "C$1,000", "₪1,000". */
export const CURRENCY_SYMBOL: Record<CurrencyCode, string> = {
  ILS: "₪",
  USD: "$",
  CAD: "C$",
};

/** The currency's name in a sentence ("בדולרים"…). */
export const CURRENCY_NAME: Record<CurrencyCode, string> = {
  ILS: "שקל",
  USD: "דולר",
  CAD: "דולר קנדי",
};

/** A row's money in US$ or C$: the amount as typed, and the rate that made its
 *  shekel amount (shekels per unit). */
export type ForeignMoney = {
  currency: ForeignCurrency;
  amount: number;
  rate: number;
  /** The rate was typed by hand, not the Bank of Israel's. */
  rateManual: boolean;
};

/** The columns a money row's currency lives in — for a select list. */
export const MONEY_CURRENCY_COLUMNS = "currency,foreign_amount,fx_rate,fx_rate_manual";

function toNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** A row's foreign money, or null for shekels — including a row read before
 *  the currency columns existed (the phone's older copy reads them as null). */
export function readForeignMoney(row: {
  currency?: unknown;
  foreign_amount?: unknown;
  fx_rate?: unknown;
  fx_rate_manual?: unknown;
}): ForeignMoney | null {
  const currency = typeof row.currency === "string" ? row.currency.trim().toUpperCase() : null;
  if (!isForeignCurrency(currency)) return null;
  const amount = toNumber(row.foreign_amount);
  const rate = toNumber(row.fx_rate);
  if (amount === null || rate === null || rate <= 0) return null;
  return {
    currency,
    amount,
    rate,
    rateManual: row.fx_rate_manual === true || row.fx_rate_manual === 1 || row.fx_rate_manual === "true",
  };
}

/** The foreign money behind part of a row's shekels — a partly paid expense's
 *  paid share, at the row's own rate. The whole row keeps its exact amount. */
export function foreignShare(foreign: ForeignMoney, shekels: number, rowShekels: number): ForeignMoney {
  if (Math.abs(shekels - rowShekels) < 0.005) return foreign;
  return { ...foreign, amount: Math.round((shekels / foreign.rate) * 100) / 100 };
}
