/**
 * The currencies money can be in (owner, 2026-10-22: the Chase account in the
 * States, the Canada buildings). Shekels are the books' own currency — every
 * total is in ₪ — and the others are turned into shekels at the Bank of
 * Israel's rate (lib/fx/rates.ts).
 */

export const FOREIGN_CURRENCIES = ["USD", "CAD"] as const;

export type ForeignCurrency = (typeof FOREIGN_CURRENCIES)[number];

export type CurrencyCode = "ILS" | ForeignCurrency;

export function isForeignCurrency(value: unknown): value is ForeignCurrency {
  return (FOREIGN_CURRENCIES as readonly unknown[]).includes(value);
}
