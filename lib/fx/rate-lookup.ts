import type { SupabaseClient } from "@supabase/supabase-js";
import type { ForeignCurrency } from "@/lib/fx/currencies";

// The Bank of Israel rate of a day, for an entry form to show while the amount
// is typed: that day's own, or the last one before it (a weekend, a holiday,
// today before 15:30) — as public.fx_rate_on works it out for the saved row.
// Read straight from public.fx_rates, which anyone signed in may read; kept
// per currency and day for the session, since a past day's rate never moves.

export type DayRate = { rate: number; date: string };

const cache = new Map<string, Promise<DayRate | null>>();

export function lookupFxRate(
  supabase: SupabaseClient,
  currency: ForeignCurrency,
  day: string
): Promise<DayRate | null> {
  const key = `${currency}|${day}`;
  const known = cache.get(key);
  if (known) return known;
  const read = Promise.resolve(
    supabase
      .from("fx_rates")
      .select("rate_date,rate")
      .eq("currency", currency)
      .lte("rate_date", day)
      .order("rate_date", { ascending: false })
      .limit(1)
      .maybeSingle()
  ).then(({ data, error }) => {
    const row = data as { rate_date?: string; rate?: number | string } | null;
    const rate = Number(row?.rate);
    if (error || !row?.rate_date || !Number.isFinite(rate) || rate <= 0) {
      cache.delete(key); // not kept: the next try may reach it
      return null;
    }
    return { rate, date: row.rate_date };
  });
  cache.set(key, read);
  return read;
}
