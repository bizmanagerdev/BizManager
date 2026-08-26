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

/* ---------------------------------------------------------------------------
 * ENTRY side — the same grouping, live, inside a money field.
 *
 * An amount is easier to read with separators while it is being TYPED, not only
 * once it is printed: "1,200,000" is countable at a glance, "1200000" is not.
 * These three power `CurrencyInput`; they live here so the one place that
 * decides what a money string looks like also decides how one is typed — and so
 * they can be unit-tested without a DOM.
 * ------------------------------------------------------------------------- */

/** Digits, one decimal point and a leading minus — nothing else. This is the
 *  string the FORM stores, so a pasted "₪1,200,000" parses like a typed one.
 *  A lone "-" survives, so a negative amount can be typed sign-first. */
export function stripMoneyGrouping(text: string): string {
  const negative = text.trim().startsWith("-");
  const digits = text.replace(/[^\d.]/g, "");
  const [intPart = "", ...rest] = digits.split(".");
  const decPart = rest.join("");
  const body = digits.includes(".") ? `${intPart}.${decPart}` : intPart;
  return negative ? `-${body}` : body;
}

/** "1200000.5" → "1,200,000.5". Keeps a trailing "." so the decimal point
 *  survives the keystroke that types it. */
export function groupMoneyDigits(raw: string): string {
  if (!raw) return "";
  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  const [intPart = "", ...rest] = body.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const suffix = body.includes(".") ? `.${rest.join("")}` : "";
  return `${negative ? "-" : ""}${grouped}${suffix}`;
}

/** One keystroke in a grouped money field.
 *
 *  `displayed` is the grouped text the field was showing, `typed` what the DOM
 *  holds after the keystroke, `caret` where the cursor landed in it. Returns the
 *  ungrouped value for the form and where the caret belongs once the text is
 *  re-grouped — the separators shift as digits are added, so a caret left where
 *  the browser put it drifts by one position per separator crossed.
 *
 *  Samsung's Hebrew keypad — what most of our field users type on inside the
 *  Capacitor shell — emits "," as the DECIMAL separator, and `Input` already
 *  reads a comma that way in every money field. That is kept here, without
 *  mistaking the separators we insert ourselves for typed ones: only a comma the
 *  user just inserted counts, which the diff against `displayed` tells us
 *  exactly. Deleting a digit out of "1,200,000" therefore stays a deletion,
 *  while "12,5" is 12.5 shekels.
 */
export function applyMoneyKeystroke(
  displayed: string,
  typed: string,
  caret: number
): { value: string; caret: number } {
  const justTypedComma = typed.length === displayed.length + 1 && typed[caret - 1] === ",";
  const normalized = justTypedComma ? `${typed.slice(0, caret - 1)}.${typed.slice(caret)}` : typed;
  const value = stripMoneyGrouping(normalized);
  const display = groupMoneyDigits(value);
  const valueCharsBefore = stripMoneyGrouping(normalized.slice(0, caret)).length;

  let seen = 0;
  let nextCaret = display.length;
  if (valueCharsBefore <= 0) {
    nextCaret = 0;
  } else {
    for (let i = 0; i < display.length; i++) {
      if (display[i] !== ",") seen++;
      if (seen === valueCharsBefore) {
        nextCaret = i + 1;
        break;
      }
    }
  }
  return { value, caret: Math.min(nextCaret, display.length) };
}
