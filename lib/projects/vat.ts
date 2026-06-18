import { DEFAULT_VAT_RATE } from "@/lib/settings/vat";

export type ProjectVatMode = {
  /** Phase 2: the agreed price is base + VAT (the customer pays the gross). */
  priceIncludesVat?: boolean | null;
  /** Frozen VAT rate for this project's gross target (fraction, e.g. 0.18). */
  vatRate?: number | string | null;
};

function rateOf(mode: ProjectVatMode): number {
  const raw = typeof mode.vatRate === "number" ? mode.vatRate : Number(mode.vatRate);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_VAT_RATE;
}

/**
 * The project's expected NET base, grossed up when the project is priced
 * "base + VAT" (Phase 2). For default (net-priced) projects this returns the
 * base unchanged. Used for the target price; collected money always counts via
 * net_amount, so this is the only place the per-project VAT mode matters.
 */
export function applyProjectVatToBase(base: number, mode: ProjectVatMode): number {
  if (!base || !Number.isFinite(base)) return base;
  if (!mode.priceIncludesVat) return base;
  return base * (1 + rateOf(mode));
}

/** The VAT portion baked into a price-includes-VAT project's gross base. */
export function projectVatPortionOfBase(base: number, mode: ProjectVatMode): number {
  if (!mode.priceIncludesVat) return 0;
  const gross = applyProjectVatToBase(base, mode);
  return gross - base;
}
