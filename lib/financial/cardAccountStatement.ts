// A statement kept on a US card's own account (owner, 2026-10-25: "each US card
// its own account, payments to it as transfers"): what the statement-row routes
// need to know about it, and how its dollar lines get their shekels. Server-side
// (routes); the page reads the same columns itself.
//
// Every line of such a statement is in the card account's currency. An expense
// or a refund made from one is ON the card account, in that currency, at the
// Bank of Israel rate of its own day — like any dollar row typed by hand
// (lib/fx/money-input.ts) — so its shekels count in every report.

import type { SupabaseClient } from "@supabase/supabase-js";
import { currencyPricing, type MoneyCurrencyColumns } from "@/lib/fx/money-input";
import { isForeignCurrency, type CurrencyCode } from "@/lib/fx/currencies";

export type StatementCardAccount = { cardAccountId: string; currency: CurrencyCode };

/** The card account a statement is kept on, or null for an Israeli statement
 *  (one bank charge a month). An error reading it is returned, never swallowed:
 *  treating a US statement as an Israeli one would write shekels. */
export async function loadStatementCardAccount(
  supabase: SupabaseClient,
  statementId: string
): Promise<{ account: StatementCardAccount | null } | { error: string }> {
  const { data, error } = await supabase
    .from("card_statements")
    .select("card_account_id,currency")
    .eq("id", statementId)
    .maybeSingle();
  if (error) return { error: error.message };
  const cardAccountId = typeof data?.card_account_id === "string" ? data.card_account_id : null;
  if (!cardAccountId) return { account: null };
  const currency = String(data?.currency ?? "ILS").toUpperCase();
  return { account: { cardAccountId, currency: isForeignCurrency(currency) ? currency : "ILS" } };
}

/** The statement a line belongs to — for the routes that are given a row. */
export async function loadRowStatementCardAccount(
  supabase: SupabaseClient,
  rowId: string
): Promise<{ account: StatementCardAccount | null; statementId: string | null } | { error: string }> {
  const { data, error } = await supabase.from("card_statement_rows").select("statement_id").eq("id", rowId).maybeSingle();
  if (error) return { error: error.message };
  const statementId = typeof data?.statement_id === "string" ? data.statement_id : null;
  if (!statementId) return { account: null, statementId: null };
  const loaded = await loadStatementCardAccount(supabase, statementId);
  if ("error" in loaded) return loaded;
  return { account: loaded.account, statementId };
}

export type PricedAmount = { shekels: number; columns: MoneyCurrencyColumns };

/**
 * Prices a statement's lines in their currency: the shekels at the Bank of
 * Israel rate of each line's day, and the currency columns beside them. One
 * rate look-up per day, however many lines share it.
 */
export function statementPricer(supabase: SupabaseClient, currency: CurrencyCode) {
  const rates = new Map<string, Promise<Awaited<ReturnType<typeof currencyPricing>>>>();
  return async (amount: number, date: string): Promise<PricedAmount | { error: string }> => {
    const day = date.slice(0, 10);
    let pricing = rates.get(day);
    if (!pricing) {
      pricing = currencyPricing(supabase, { currency }, { amount: 1, date: day });
      rates.set(day, pricing);
    }
    const p = await pricing;
    if ("error" in p) return { error: p.error };
    const columns = p.columns ?? { currency: "ILS", foreign_amount: null, fx_rate: null, fx_rate_manual: false };
    if (columns.currency === "ILS") {
      return { shekels: Math.round(amount * 100) / 100, columns };
    }
    return {
      shekels: p.toShekels(amount),
      columns: { ...columns, foreign_amount: Math.round(amount * 100) / 100 },
    };
  };
}
