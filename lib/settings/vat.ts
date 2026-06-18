import type { SupabaseClient } from "@supabase/supabase-js";

// The current VAT rate is a single editable business setting (business_settings),
// frozen onto each payment row when it is recorded so that changing the rate later
// never alters historical payments. Israeli VAT was 17% and is 18% from 2025.
export const DEFAULT_VAT_RATE = 0.18;

/** Clamp to a sane fraction (e.g. 0.18). Accepts a percentage (18) too. */
export function normalizeVatRate(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return DEFAULT_VAT_RATE;
  // Tolerate the rate being entered as a percentage (18 → 0.18).
  const rate = n > 1 ? n / 100 : n;
  return rate > 1 ? DEFAULT_VAT_RATE : Math.round(rate * 10000) / 10000;
}

export async function getCurrentVatRate(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("business_settings")
    .select("vat_rate")
    .eq("id", true)
    .maybeSingle();

  if (error || !data) return DEFAULT_VAT_RATE;
  return normalizeVatRate((data as { vat_rate?: unknown }).vat_rate);
}

export async function setCurrentVatRate(
  supabase: SupabaseClient,
  rate: number,
  updatedBy: string
): Promise<void> {
  const normalized = normalizeVatRate(rate);
  const { error } = await supabase
    .from("business_settings")
    .upsert(
      { id: true, vat_rate: normalized, updated_at: new Date().toISOString(), updated_by: updatedBy },
      { onConflict: "id" }
    );
  if (error) throw new Error(error.message);
}
