import type { SupabaseClient } from "@supabase/supabase-js";

// The credit-card clearing company (e.g. Grow) deducts a percentage fee
// before depositing a settlement batch — see lib/accounts.ts's
// growthBatches. This is a single editable business setting
// (business_settings.cc_fee_rate), same singleton pattern as vat_rate.
export const DEFAULT_CC_FEE_RATE = 0.14;

/** Clamp to a sane fraction (e.g. 0.14). Accepts a percentage (14) too. */
export function normalizeCcFeeRate(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return DEFAULT_CC_FEE_RATE;
  // Tolerate the rate being entered as a percentage (14 → 0.14).
  const rate = n > 1 ? n / 100 : n;
  return rate > 1 ? DEFAULT_CC_FEE_RATE : Math.round(rate * 10000) / 10000;
}

export async function getCurrentCcFeeRate(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("business_settings")
    .select("cc_fee_rate")
    .eq("id", true)
    .maybeSingle();

  if (error || !data) return DEFAULT_CC_FEE_RATE;
  return normalizeCcFeeRate((data as { cc_fee_rate?: unknown }).cc_fee_rate);
}

export async function setCurrentCcFeeRate(
  supabase: SupabaseClient,
  rate: number,
  updatedBy: string
): Promise<void> {
  const normalized = normalizeCcFeeRate(rate);
  const { error } = await supabase
    .from("business_settings")
    .upsert(
      { id: true, cc_fee_rate: normalized, updated_at: new Date().toISOString(), updated_by: updatedBy },
      { onConflict: "id" }
    );
  if (error) throw new Error(error.message);
}
