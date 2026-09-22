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

/**
 * What the price typed into a project form means, when the project is priced
 * "base + VAT". The stored `agreed_base_price` is always the BASE; a price
 * typed as the full amount the customer pays is divided back here, so nobody
 * has to work it out on a calculator.
 */
export type ProjectPriceEntry = "base" | "gross";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The base price to store for an amount typed as base, or as the full sum. */
export function baseFromPriceEntry(amount: number, entry: ProjectPriceEntry, rate: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const safeRate = Number.isFinite(rate) && rate >= 0 ? rate : DEFAULT_VAT_RATE;
  return entry === "gross" ? round2(amount / (1 + safeRate)) : round2(amount);
}

/** Base, VAT and the full sum, for showing the user what their number becomes. */
export function projectPriceSplit(base: number, rate: number): { base: number; vat: number; gross: number } {
  const safeBase = Number.isFinite(base) && base > 0 ? round2(base) : 0;
  const safeRate = Number.isFinite(rate) && rate >= 0 ? rate : DEFAULT_VAT_RATE;
  const gross = round2(safeBase * (1 + safeRate));
  return { base: safeBase, vat: round2(gross - safeBase), gross };
}

