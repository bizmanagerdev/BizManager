/**
 * The currencies money can be in (owner, 2026-10-22: the Chase account in the
 * States, the Canada buildings). Shekels are the books' own currency — every
 * total is in ₪ — and the others are turned into shekels at the Bank of
 * Israel's rate (lib/fx/rates.ts).
 *
 * A money row keeps its shekel amount in its usual column, and beside it the
 * amount as typed and its day's rate (supabase/migrations/
 * 20261023120001_money_currency.sql). `readForeignMoney` reads those.
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

/** A row's currency as an edit form takes it (components/fx/MoneyCurrency):
 *  its four columns from its read foreign money — or nothing at all when it
 *  wasn't read (`undefined`), so the form leaves the row's currency as it is. */
export function currencyFieldsFrom(foreign: ForeignMoney | null | undefined): {
  currency?: CurrencyCode;
  foreign_amount?: number | null;
  fx_rate?: number | null;
  fx_rate_manual?: boolean;
} {
  if (foreign === undefined) return {};
  if (foreign === null) return { currency: "ILS", foreign_amount: null, fx_rate: null, fx_rate_manual: false };
  return { currency: foreign.currency, foreign_amount: foreign.amount, fx_rate: foreign.rate, fx_rate_manual: foreign.rateManual };
}

/** The same from a raw row: nothing when it was read without its currency. */
export function rowCurrencyFields(row: Record<string, unknown> | null | undefined) {
  if (!row || !Object.prototype.hasOwnProperty.call(row, "currency")) return {};
  return currencyFieldsFrom(readForeignMoney(row));
}

/** Each currency's latest Bank of Israel rate, and the day it is of — what a
 *  US$ balance is worth in shekels today (lib/fx/rates.ts loadTodayFxRates). */
export type TodayFxRates = Partial<Record<ForeignCurrency, { rate: number; date: string }>>;

/** An amount in its currency, in shekels at today's rate; null when there's
 *  no rate to use. Shekels are themselves. */
export function shekelsToday(amount: number, currency: CurrencyCode, rates: TodayFxRates): number | null {
  if (currency === "ILS") return amount;
  const today = rates[currency];
  return today ? Math.round(amount * today.rate * 100) / 100 : null;
}

/** The foreign money behind part of a row's shekels — a partly paid expense's
 *  paid share, at the row's own rate. The whole row keeps its exact amount. */
export function foreignShare(foreign: ForeignMoney, shekels: number, rowShekels: number): ForeignMoney {
  if (Math.abs(shekels - rowShekels) < 0.005) return foreign;
  return { ...foreign, amount: Math.round((shekels / foreign.rate) * 100) / 100 };
}
