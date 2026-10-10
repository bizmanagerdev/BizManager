// Each delivery city's colour (owner, 2026-10-11): the strip down a stop's
// card and the dot by the city's name, so a driver sees where one city's stops
// end — "when I finished all the oranges, I finished Jerusalem". Fixed per
// city, never by position: ירושלים is always orange, בני ברק always purple,
// so the colours are learnt once.
//
// One even brightness and strength for all (OKLCH), soft and current rather
// than the bright primaries of a default palette; none is a plain red, amber
// or green, which already mean unpaid, collect on delivery and call.

/** The cities most deliveries go to, each with a colour of its own. */
const FIXED: Record<string, string> = {
  "ירושלים": "oklch(0.72 0.15 52)", // papaya orange
  "בני ברק": "oklch(0.62 0.15 305)", // orchid purple
  "בית שמש": "oklch(0.68 0.11 185)", // jade teal
  "מודיעין עילית": "oklch(0.70 0.11 237)", // sky blue
  "אשדוד": "oklch(0.76 0.14 122)", // citron lime
  "ביתר עילית": "oklch(0.72 0.13 355)", // pink lemonade
  "אלעד": "oklch(0.60 0.07 45)", // cocoa
  "נתניה": "oklch(0.60 0.13 275)", // indigo
  "ערד": "oklch(0.78 0.11 82)", // sand
  "תל אביב": "oklch(0.68 0.07 155)", // sage
  "גבעת זאב": "oklch(0.62 0.06 250)", // dusty blue
  "קרית גת": "oklch(0.66 0.08 330)", // mauve
};

/** Any other city: one of these, chosen by its name — so the same every time. */
const SPARE = [
  "oklch(0.70 0.10 205)", // lagoon
  "oklch(0.66 0.12 290)", // lavender
  "oklch(0.74 0.12 70)", // apricot
  "oklch(0.64 0.09 165)", // eucalyptus
  "oklch(0.68 0.11 15)", // rose clay
  "oklch(0.66 0.10 260)", // periwinkle
];

/** "בני-ברק", " ירושלים ", "כפר חב"ד" → the one spelling the table above uses. */
function normalizeCity(city: string): string {
  return city
    .trim()
    .replace(/[-–—]/g, " ")
    .replace(/["״]/g, "״")
    .replace(/\s+/g, " ");
}

/** The colour of a delivery city (a CSS colour, for a strip or a dot). */
export function cityColour(city: string | null | undefined): string {
  const name = normalizeCity(city ?? "");
  const fixed = FIXED[name];
  if (fixed) return fixed;
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return SPARE[hash % SPARE.length];
}
