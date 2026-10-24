import type { SupabaseClient } from "@supabase/supabase-js";
import { FOREIGN_CURRENCIES, type ForeignCurrency, type TodayFxRates } from "@/lib/fx/currencies";
import { israelDateKey } from "@/lib/timezone";

// ════════════════════════════════════════════════════════════════════════════
// Exchange rates — the Bank of Israel's official daily rate (שער יציג) for each
// foreign currency, kept in public.fx_rates (one row per currency per day).
//
// The bank publishes them free, with no key, through its SDMX service, Monday
// to Friday at about 15:30 Israel time and not on Israeli holidays. The owner
// suggested Google Cloud for this; it has no rate service of its own, and
// nothing else is needed — /api/cron/fx-rates asks the bank twice a day.
//
// A day with no rate of its own (a weekend, a holiday, today before 15:30)
// takes the last one before it — public.fx_rate_on in the database.
// ════════════════════════════════════════════════════════════════════════════

export type FxRate = {
  currency: ForeignCurrency;
  rateDate: string; // YYYY-MM-DD
  /** Shekels per one unit: 3.107 for US$ on 22/10/2026. */
  rate: number;
};

const BOI_DATA_URL = "https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0";

const BOI_SERIES: Record<ForeignCurrency, string> = {
  USD: "RER_USD_ILS",
  CAD: "RER_CAD_ILS",
};

/** How far back the table reaches: the first run loads every rate since then,
 *  so a purchase or loan from years ago still finds its day's rate. */
export const FX_HISTORY_START = "2015-01-01";

/** Each run asks again for the days just before the newest rate it has: one
 *  the bank published late, or corrected, is picked up on the next run. */
const REFETCH_DAYS = 10;

/** The bank's longest pause since 2015 is 7 days (Pesach 2020). A newest rate
 *  older than this means the job, or the bank's service, has stopped. */
export const FX_STALE_AFTER_DAYS = 8;

/** Far outside anything either rate has been (US$ 2.81–4.08, C$ 2.03–3.37
 *  since 2015): a value out here is a misread answer, not a rate. */
const PLAUSIBLE_RATE = { min: 0.5, max: 20 };

export function boiRatesUrl(since: string, until: string): string {
  const series = FOREIGN_CURRENCIES.map((c) => BOI_SERIES[c]).join(",");
  return `${BOI_DATA_URL}/${series}?startperiod=${since}&endperiod=${until}&format=csv`;
}

/** One CSV line, with quoted cells (a quoted cell may hold a comma). */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

/** The bank's CSV answer → rates. Columns are found by name, so a column the
 *  bank adds or moves doesn't shift the values; lines that aren't one of our
 *  series, or don't hold a real date and rate, are skipped. */
export function parseBoiCsv(csv: string): FxRate[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.toUpperCase());
  const seriesAt = header.indexOf("SERIES_CODE");
  const dateAt = header.indexOf("TIME_PERIOD");
  const valueAt = header.indexOf("OBS_VALUE");
  if (seriesAt < 0 || dateAt < 0 || valueAt < 0) {
    throw new Error("Bank of Israel rates: the answer has no SERIES_CODE / TIME_PERIOD / OBS_VALUE columns");
  }
  const currencyOfSeries = new Map(FOREIGN_CURRENCIES.map((c) => [BOI_SERIES[c], c] as const));
  const rates: FxRate[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const currency = currencyOfSeries.get(cells[seriesAt] ?? "");
    const rateDate = cells[dateAt] ?? "";
    const rate = Number(cells[valueAt]);
    if (!currency || !/^\d{4}-\d{2}-\d{2}$/.test(rateDate)) continue;
    if (!Number.isFinite(rate) || rate < PLAUSIBLE_RATE.min || rate > PLAUSIBLE_RATE.max) continue;
    rates.push({ currency, rateDate, rate });
  }
  return rates;
}

/** Every rate the bank published between two days (inclusive). The service
 *  answers 404 for a stretch with no rates at all (a weekend), so that is an
 *  empty answer, not a failure. */
export async function fetchBoiRates(
  since: string,
  until: string,
  fetchImpl: typeof fetch = fetch
): Promise<FxRate[]> {
  const res = await fetchImpl(boiRatesUrl(since, until), {
    headers: { Accept: "text/csv" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Bank of Israel rates: the service answered ${res.status}`);
  return parseBoiCsv(await res.text());
}

export function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Each currency's newest rate — today's, or the last one before today on a
 *  weekend, a holiday or before 15:30. A currency whose read fails is left
 *  out (the page shows its balance without the shekels then). */
export async function loadTodayFxRates(supabase: SupabaseClient): Promise<TodayFxRates> {
  const rates: TodayFxRates = {};
  await Promise.all(
    FOREIGN_CURRENCIES.map(async (currency) => {
      const { data, error } = await Promise.resolve(
        supabase
          .from("fx_rates")
          .select("rate_date,rate")
          .eq("currency", currency)
          .order("rate_date", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).catch((err: unknown) => ({ data: null, error: err }));
      const row = data as { rate_date?: string; rate?: number | string } | null;
      const rate = Number(row?.rate);
      if (!error && row?.rate_date && Number.isFinite(rate) && rate > 0) {
        rates[currency] = { rate, date: row.rate_date };
      }
    })
  );
  return rates;
}

export type FxSyncResult = {
  since: string;
  until: string;
  /** Rates received from the bank and written (new days, and the days asked
   *  again in case they changed). */
  saved: number;
  /** The newest rate each currency has after the run. */
  latest: Record<ForeignCurrency, string | null>;
  /** Currencies whose newest rate is older than FX_STALE_AFTER_DAYS. */
  stale: ForeignCurrency[];
};

/** Brings public.fx_rates up to date: the whole history into an empty table,
 *  after that the last few days. Safe to repeat — a day already there is
 *  written over with what the bank says now. Needs the service-role client
 *  (only the server may write rates). */
export async function syncFxRates(
  supabase: SupabaseClient,
  { today = israelDateKey(), fetchImpl }: { today?: string; fetchImpl?: typeof fetch } = {}
): Promise<FxSyncResult> {
  const newest = await Promise.all(
    FOREIGN_CURRENCIES.map(async (currency) => {
      const { data, error } = await supabase
        .from("fx_rates")
        .select("rate_date")
        .eq("currency", currency)
        .order("rate_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`fx_rates read failed: ${error.message}`);
      return (data as { rate_date?: string } | null)?.rate_date ?? null;
    })
  );

  const known = newest.filter((d): d is string => Boolean(d));
  const since =
    known.length < FOREIGN_CURRENCIES.length
      ? FX_HISTORY_START
      : shiftDateKey(known.reduce((min, d) => (d < min ? d : min)), -REFETCH_DAYS);

  const rates = await fetchBoiRates(since, today, fetchImpl);

  const fetchedAt = new Date().toISOString();
  const rows = rates.map((r) => ({
    currency: r.currency,
    rate_date: r.rateDate,
    rate: r.rate,
    source: "boi",
    fetched_at: fetchedAt,
  }));
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await supabase
      .from("fx_rates")
      .upsert(rows.slice(i, i + 1000), { onConflict: "currency,rate_date" });
    if (error) throw new Error(`fx_rates write failed: ${error.message}`);
  }

  const latest = Object.fromEntries(
    FOREIGN_CURRENCIES.map((currency, i) => {
      const fetched = rates.filter((r) => r.currency === currency).map((r) => r.rateDate);
      const best = [newest[i], ...fetched].reduce<string | null>(
        (max, d) => (d && (!max || d > max) ? d : max),
        null
      );
      return [currency, best];
    })
  ) as Record<ForeignCurrency, string | null>;

  const stale = FOREIGN_CURRENCIES.filter((c) => {
    const d = latest[c];
    return !d || daysBetween(d, today) > FX_STALE_AFTER_DAYS;
  });

  return { since, until: today, saved: rows.length, latest, stale };
}
