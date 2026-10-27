import type { SupabaseClient } from "@supabase/supabase-js";
import type { ForeignCurrency } from "@/lib/fx/currencies";
import { isServerReachable } from "@/lib/pwa/connection";

// The Bank of Israel rate of a day, for an entry form to show while the amount
// is typed: that day's own, or the last one before it (a weekend, a holiday,
// today before 15:30) — as public.fx_rate_on works it out for the saved row.
// Read straight from public.fx_rates, which anyone signed in may read; kept
// per currency and day for the session, since a past day's rate never moves.
//
// With no connection, from the device copy instead: an admin's and the
// office's has the rates since 2025 (sync rules v1.14), so a line in US$ typed
// on the accounts page offline still gets its day's rate (owner, 2026-10-28:
// "go on with opens with no connection"). Not kept: once the server answers
// again, it's asked.

export type DayRate = { rate: number; date: string };

const cache = new Map<string, Promise<DayRate | null>>();

type RateRow = { rate_date?: string; rate?: number | string } | null;

function dayRateOf(row: RateRow): DayRate | null {
  const rate = Number(row?.rate);
  return row?.rate_date && Number.isFinite(rate) && rate > 0 ? { rate, date: row.rate_date } : null;
}

function readRate(supabase: SupabaseClient, currency: ForeignCurrency, day: string): Promise<DayRate | null> {
  return Promise.resolve(
    supabase
      .from("fx_rates")
      .select("rate_date,rate")
      .eq("currency", currency)
      .lte("rate_date", day)
      .order("rate_date", { ascending: false })
      .limit(1)
      .maybeSingle()
  ).then(
    ({ data, error }) => (error ? null : dayRateOf(data as RateRow)),
    () => null
  );
}

/** The rate from the device copy, when it's ready and has the rates. */
async function deviceRate(currency: ForeignCurrency, day: string): Promise<DayRate | null> {
  try {
    const { readyLocalDatabase } = await import("@/lib/powersync/store");
    const db = readyLocalDatabase();
    if (!db) return null;
    const { localClient } = await import("@/lib/powersync/local-results");
    return await readRate(await localClient(db), currency, day);
  } catch {
    return null;
  }
}

export function lookupFxRate(
  supabase: SupabaseClient,
  currency: ForeignCurrency,
  day: string
): Promise<DayRate | null> {
  const key = `${currency}|${day}`;
  const known = cache.get(key);
  if (known) return known;
  if (!isServerReachable()) return deviceRate(currency, day);
  const read = readRate(supabase, currency, day).then(async (found) => {
    if (found) return found;
    cache.delete(key); // not kept: the next try may reach it
    // The connection dropped just now (the server didn't answer): the device's.
    return deviceRate(currency, day);
  });
  cache.set(key, read);
  return read;
}
