// Hebrew counting.
//
// Hebrew has a dual: one day is יום, two days are יומיים — never "2 ימים".
// Intl.PluralRules knows the language's own categories, so this stays right for
// counts where the rule is not obvious (20 and 30 are their own category in
// Hebrew CLDR) instead of encoding a guess.

const RULES = new Intl.PluralRules("he");

export type HebrewForms = {
  /** One of them, with no numeral: "יום אחד". */
  one: string;
  /** Two of them, with no numeral: "יומיים". */
  two: string;
  /** The plural noun alone; the numeral is prefixed: "ימים" → "5 ימים". */
  many: string;
};

export function pluralHe(count: number, forms: HebrewForms): string {
  const n = Math.abs(Math.trunc(count));
  switch (RULES.select(n)) {
    case "one":
      return forms.one;
    case "two":
      return forms.two;
    default:
      return `${n} ${forms.many}`;
  }
}

/** Days — the count this app asks for most. */
export function daysHe(count: number): string {
  return pluralHe(count, { one: "יום אחד", two: "יומיים", many: "ימים" });
}

/** Orders — "הזמנה אחת", "2 הזמנות" (the customers list and a customer's page). */
export function ordersHe(count: number): string {
  return pluralHe(count, { one: "הזמנה אחת", two: "2 הזמנות", many: "הזמנות" });
}

/** Projects — "פרויקט אחד", "2 פרויקטים", never "1 פרויקטים". */
export function projectsHe(count: number): string {
  return pluralHe(count, { one: "פרויקט אחד", two: "2 פרויקטים", many: "פרויקטים" });
}

/** Documents — "מסמך אחד", "2 מסמכים", never "1 מסמכים". */
export function documentsHe(count: number): string {
  return pluralHe(count, { one: "מסמך אחד", two: "2 מסמכים", many: "מסמכים" });
}
