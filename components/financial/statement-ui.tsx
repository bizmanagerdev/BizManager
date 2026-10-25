// The small pieces every credit-card statement screen shares — the upload page, the
// statement page and the cards list — so they read as one section: the status chips
// and the title over each step's panel.

import { formatCurrencyAmount } from "@/lib/money";
import type { CurrencyCode } from "@/lib/fx/currencies";

/** A US card statement's amount, to the cent as the statement prints it:
 *  "$4.50", "$2,135" — the app's own format would write "$4.5". */
export function formatStatementAmount(value: number, currency: CurrencyCode): string {
  if (currency === "ILS" || Number.isInteger(Math.round(value * 100) / 100)) return formatCurrencyAmount(value, currency);
  const text = formatCurrencyAmount(value, currency);
  return /[.,]\d$/.test(text) ? `${text}0` : text;
}

export const STATUS_CHIP = {
  ok: "rounded bg-success-soft px-1.5 py-0.5 text-xs font-medium text-success-soft-foreground",
  warn: "rounded bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning-soft-foreground",
  info: "rounded bg-info-soft px-1.5 py-0.5 text-xs font-medium text-info-soft-foreground",
  plain: "rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground",
} as const;

export type ChipTone = keyof typeof STATUS_CHIP;

export function PanelTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
