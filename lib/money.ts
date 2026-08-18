/**
 * THE money format for the app — one function, one shape: ₪ FIRST, he-IL
 * grouping, decimals only when the amount has them.
 *
 *     formatMoney(5000)      // ₪5,000
 *     formatMoney(1356.97)   // ₪1,356.97
 *
 * WHY NOT Intl's currency style: `he-IL` puts the symbol AFTER the number and
 * wraps the whole thing in RTL marks (`‏5,000 ‏₪`), while every hand-written
 * money string in the app — chart axes, audit summaries, the money inputs, which
 * put the ₪ on the left by design — puts it first. Having both is the tell of a
 * system that grew rather than one that was designed, and the reader pays for it:
 * two shapes for the same quantity, in columns that no longer line up.
 *
 * Pair with `tabular-nums` wherever amounts stack (rows, tables, totals) so the
 * digits sit in a grid — proportional digits make a column of numbers ragged even
 * when the format is identical.
 */

const GROUPED = new Intl.NumberFormat("he-IL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** `₪1,234.5` — the canonical display of an amount. */
export function formatMoney(value: number | string | null | undefined): string {
  return `₪${GROUPED.format(toNumber(value))}`;
}

/** The same, rounded to whole shekels — for axes, chips and other tight spots. */
export function formatMoneyRounded(value: number | string | null | undefined): string {
  return `₪${Math.round(toNumber(value)).toLocaleString("he-IL")}`;
}
