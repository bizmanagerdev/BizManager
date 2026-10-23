import type { SupabaseClient } from "@supabase/supabase-js";
import { FOREIGN_CURRENCIES, type CurrencyCode, type ForeignCurrency, type ForeignMoney } from "@/lib/fx/currencies";
import { shiftDateKey } from "@/lib/fx/rates";
import { fetchAllPaged } from "@/lib/supabase/paginate";

// Money in ₪, $ and C$ at once (owner, 2026-10-23, the Canada buildings: "I
// need to see all three … how much did I pay there, the totals"): each
// movement at its own day's Bank of Israel rate, so a payment made in dollars
// and one made in C$ add up in all three. Its shekels are as booked; a row in
// US$ or C$ keeps its own amount in its currency; the rest is its shekels at
// that day's rate (the last one before it on a weekend or a holiday, as
// public.fx_rate_on works it out).

/** The rates over a stretch of days, per currency, oldest first. */
export type RateTable = Record<ForeignCurrency, { days: string[]; rates: number[] }>;

export type InEachCurrency = Record<CurrencyCode, number | null>;

export const ALL_CURRENCIES: readonly CurrencyCode[] = ["ILS", "USD", "CAD"];

/** The rate on that day, or the last one before it; null before the table starts. */
export function rateOn(table: RateTable, currency: ForeignCurrency, day: string): number | null {
  const { days, rates } = table[currency];
  let low = 0;
  let high = days.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (days[mid] <= day) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found < 0 ? null : rates[found];
}

/**
 * A movement's money in each currency: its shekels as booked; in its own
 * currency, its own amount (any part of it — a partly paid share — at the
 * row's own rate); in the other, its shekels at the day's rate. Null where
 * there's no rate to use (the rates not loaded yet, or no day).
 */
export function inEachCurrency(
  shekels: number,
  day: string | null,
  foreign: ForeignMoney | null | undefined,
  table: RateTable | null
): InEachCurrency {
  const out: InEachCurrency = { ILS: shekels, USD: null, CAD: null };
  for (const currency of FOREIGN_CURRENCIES) {
    if (foreign?.currency === currency) {
      out[currency] = shekels / foreign.rate;
      continue;
    }
    const rate = table && day ? rateOn(table, currency, day) : null;
    out[currency] = rate ? shekels / rate : null;
  }
  return out;
}

/** An amount typed in a currency (a property's purchase price) in each, at the day's rate. */
export function amountInEachCurrency(
  amount: number,
  currency: CurrencyCode,
  day: string | null,
  table: RateTable | null
): InEachCurrency {
  if (currency === "ILS") return inEachCurrency(amount, day, null, table);
  const rate = table && day ? rateOn(table, currency, day) : null;
  if (!rate) return { ILS: null, USD: currency === "USD" ? amount : null, CAD: currency === "CAD" ? amount : null };
  // Its own currency exactly as typed, not back through the rate.
  return { ...inEachCurrency(amount * rate, day, null, table), [currency]: amount };
}

/** Added up; a currency with any movement it couldn't convert is null. */
export function addInEachCurrency(a: InEachCurrency, b: InEachCurrency): InEachCurrency {
  const out = {} as InEachCurrency;
  for (const currency of ALL_CURRENCIES) {
    const x = a[currency];
    const y = b[currency];
    out[currency] = x === null || y === null ? null : x + y;
  }
  return out;
}

export const ZERO_IN_EACH: InEachCurrency = { ILS: 0, USD: 0, CAD: 0 };

/**
 * The rates from `from` to `to`, both currencies — and the ten days before
 * `from`, so a first movement on a weekend or a holiday has its rate.
 */
export async function loadRateTable(supabase: SupabaseClient, from: string, to: string): Promise<RateTable> {
  const rows = await fetchAllPaged<{ currency: string; rate_date: string; rate: number | string }>((start, end) =>
    supabase
      .from("fx_rates")
      .select("currency,rate_date,rate")
      .gte("rate_date", shiftDateKey(from, -10))
      .lte("rate_date", to)
      .order("currency")
      .order("rate_date")
      .range(start, end)
  );
  const table: RateTable = { USD: { days: [], rates: [] }, CAD: { days: [], rates: [] } };
  for (const row of rows) {
    const currency = row.currency as ForeignCurrency;
    const rate = Number(row.rate);
    if (!table[currency] || !Number.isFinite(rate) || rate <= 0) continue;
    table[currency].days.push(row.rate_date);
    table[currency].rates.push(rate);
  }
  return table;
}
