// Each delivery city's colour (owner, 2026-10-11): the strip down a stop's
// card and the dot by the city's name, so a driver sees where one city's stops
// end — "when I finished all of one colour, I finished that city". Fixed per
// city, never by position, so the colours are learnt once.
//
// A light, sweet palette (owner: "more like light, sweet … a nice peach"), with
// no purple, no orange and no browns. The six busiest cities have six colours
// of their own, as far apart as pastels go; every other city gets a colour of
// its own from a second set — not one of the six again.

/** The six busiest cities: ירושלים, בני ברק and בית שמש — almost always on screen
 *  together — on the three furthest apart. */
const MAIN: Record<string, string> = {
  "ירושלים": "oklch(0.80 0.11 166)", // mint
  "בני ברק": "oklch(0.78 0.11 238)", // sky blue
  "בית שמש": "oklch(0.78 0.12 2)", // blush pink
  "מודיעין עילית": "oklch(0.87 0.14 98)", // butter yellow
  "אשדוד": "oklch(0.83 0.10 55)", // peach
  "ביתר עילית": "oklch(0.84 0.10 198)", // aqua
};

/** Every other city — each of the ones deliveries have gone to has one of its own. */
const MORE = [
  "oklch(0.87 0.14 120)", // pistachio
  "oklch(0.72 0.12 350)", // rose
  "oklch(0.74 0.10 262)", // cornflower
  "oklch(0.80 0.10 25)", // coral pink
  "oklch(0.76 0.06 150)", // sage
  "oklch(0.86 0.05 225)", // powder blue
  "oklch(0.92 0.09 106)", // lemon
  "oklch(0.72 0.08 188)", // sea green
  "oklch(0.84 0.07 15)", // rose quartz
  "oklch(0.80 0.08 140)", // fern
] as const;

/** The other cities deliveries have gone to, each on a colour of MORE that's its own. */
const FIXED_MORE: Record<string, string> = {
  "אלעד": MORE[0],
  "נתניה": MORE[2],
  "ערד": MORE[3],
  "תל אביב": MORE[1],
  "גבעת זאב": MORE[4],
  "קרית גת": MORE[5],
  "בת ים": MORE[6],
  "רחובות": MORE[7],
  "פתח תקווה": MORE[8],
  "רעננה": MORE[9],
};

/** Every colour a city can have (the six, then the rest). */
export const CITY_COLOURS: readonly string[] = [...Object.values(MAIN), ...MORE];

/** "בני-ברק", " ירושלים ", "כפר חב"ד" → the one spelling the tables above use. */
function normalizeCity(city: string): string {
  return city
    .trim()
    .replace(/[-–—]/g, " ")
    .replace(/["״]/g, "״")
    .replace(/\s+/g, " ");
}

/**
 * The colour of a delivery city (a CSS colour, for a strip or a dot). A city
 * not in the tables gets one of MORE chosen by its name — the same every time,
 * and never one of the six busiest cities' colours.
 */
export function cityColour(city: string | null | undefined): string {
  const name = normalizeCity(city ?? "");
  const fixed = MAIN[name] ?? FIXED_MORE[name];
  if (fixed) return fixed;
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return MORE[hash % MORE.length];
}
