import type { SupabaseClient } from "@supabase/supabase-js";
import { CURRENCY_NAME, isForeignCurrency, type ForeignCurrency } from "@/lib/fx/currencies";
import { israelDateKey } from "@/lib/timezone";

// ════════════════════════════════════════════════════════════════════════════
// A money row's currency as an entry form sends it (owner, 2026-10-23: "a ₪ /
// $ / C$ choice beside the amount … the rate filled in and editable"):
//
//   currency        "ILS" | "USD" | "CAD" — absent from a form that doesn't
//                   know the row's currency (an older screen, or a phone on an
//                   older build): then the row's currency is left as it is
//   fx_rate         only when typed by hand (fx_rate_manual: true); otherwise
//                   the server takes the Bank of Israel rate of the row's day
//
// and its amounts IN THAT CURRENCY. A route turns them into the row's columns:
// the shekel amount(s) its usual columns hold — at the same rate, so a partly
// paid expense's paid share matches — and the currency columns beside them
// (supabase/migrations/20261023120000_money_currency.sql keeps them in step).
// ════════════════════════════════════════════════════════════════════════════

export type MoneyCurrencyBody = {
  currency?: unknown;
  fx_rate?: unknown;
  fx_rate_manual?: unknown;
};

export type MoneyCurrencyColumns = {
  currency: "ILS" | ForeignCurrency;
  foreign_amount: number | null;
  fx_rate: number | null;
  fx_rate_manual: boolean;
};

export type CurrencyPricing = {
  /** The row's currency columns — null when the form didn't say (leave them). */
  columns: MoneyCurrencyColumns | null;
  /** An amount the form typed, in shekels at the row's rate. */
  toShekels: (amount: number) => number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The row's day by Israel's calendar: "2026-10-22" as it is, a timestamp
 *  turned into its Israeli date. */
export function rowDay(date: string | null | undefined): string {
  if (!date) return israelDateKey();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? israelDateKey() : israelDateKey(parsed);
}

/**
 * How a form's typed amounts become the row's columns. `amount` is the row's
 * own amount as typed (its foreign_amount); `date` the row's day.
 */
export async function currencyPricing(
  supabase: SupabaseClient,
  body: MoneyCurrencyBody,
  { amount, date }: { amount: number; date: string | null | undefined }
): Promise<CurrencyPricing | { error: string }> {
  if (body.currency === undefined || body.currency === null || body.currency === "") {
    return { columns: null, toShekels: (value) => value };
  }
  const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
  if (currency === "ILS") {
    return {
      columns: { currency: "ILS", foreign_amount: null, fx_rate: null, fx_rate_manual: false },
      toShekels: (value) => value,
    };
  }
  if (!isForeignCurrency(currency)) return { error: "מטבע לא מוכר." };

  const manual = body.fx_rate_manual === true;
  let rate = manual ? Number(body.fx_rate) : NaN;
  if (manual && !(Number.isFinite(rate) && rate > 0)) return { error: "השער שהוקלד אינו תקין." };
  if (!manual) {
    const day = rowDay(date);
    const { data, error } = await supabase.rpc("fx_rate_on", { p_currency: currency, p_date: day });
    rate = Number(data);
    if (error || !(Number.isFinite(rate) && rate > 0)) {
      return {
        error: `אין שער יציג ל${CURRENCY_NAME[currency]} ליום ${day.split("-").reverse().join("/")} — יש להקליד את השער.`,
      };
    }
  }

  return {
    columns: { currency, foreign_amount: round2(amount), fx_rate: rate, fx_rate_manual: manual },
    toShekels: (value) => round2(value * rate),
  };
}
