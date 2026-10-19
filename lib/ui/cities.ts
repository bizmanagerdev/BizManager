/**
 * Israeli cities — sorted by Hebrew alphabetical order.
 * Focused on the Jerusalem area + greater Tel Aviv + the major cities in
 * Israel that customers might be from. "אחר" (Other) is always last so the
 * user can fall back to a manual entry.
 */
export const CITY_OPTIONS = [
  "אופקים",
  "אילת",
  "אלון שבות",
  "אלעד",
  "אפרת",
  "אריאל",
  "אשדוד",
  "אשקלון",
  "באר שבע",
  "בית שמש",
  "ביתר עילית",
  "בני ברק",
  "בת ים",
  "גבעת זאב",
  "גבעתיים",
  "דימונה",
  "הוד השרון",
  "הר אדר",
  "הר יונה",
  "הרצליה",
  "חולון",
  "חיפה",
  "חצור הגלילית",
  "טבריה",
  "טלזסטון",
  "יבנה",
  "ירושלים",
  "כוכב יעקב",
  "כפר חב״ד",
  "כפר סבא",
  "כפר עציון",
  "כרמיאל",
  "לוד",
  "מבשרת ציון",
  "מגדל העמק",
  "מודיעין",
  "מודיעין עילית",
  "מירון",
  "מעלה אדומים",
  "נווה דניאל",
  "נוף הגליל",
  "נס ציונה",
  "נצרת",
  "נתיבות",
  "נתניה",
  "סכנין",
  "עכו",
  "עלי",
  "עפולה",
  "ערד",
  "פתח תקווה",
  "צפת",
  "קרית אונו",
  "קרית אתא",
  "קרית ביאליק",
  "קרית גת",
  "קרית מוצקין",
  "קרית מלאכי",
  "קרית ספר",
  "קרית שמונה",
  "קרית ים",
  "ראש העין",
  "ראשון לציון",
  "רחובות",
  "רמלה",
  "רמת גן",
  "רמת השרון",
  "רעננה",
  "שדרות",
  "תל אביב",
  "אחר",
] as const;

export type DeliveryRegion = "צפון" | "מרכז" | "דרום";

export const DELIVERY_REGIONS: DeliveryRegion[] = ["מרכז", "צפון", "דרום"];

const CITY_REGION_MAP: Record<string, DeliveryRegion> = {
  // ━━ צפון ━━
  "חיפה": "צפון",
  "קרית אתא": "צפון",
  "קרית ביאליק": "צפון",
  "קרית מוצקין": "צפון",
  "קרית ים": "צפון",
  "עכו": "צפון",
  "כרמיאל": "צפון",
  "הר יונה": "צפון",
  "נוף הגליל": "צפון",
  "נצרת": "צפון",
  "עפולה": "צפון",
  "מגדל העמק": "צפון",
  "טבריה": "צפון",
  "חצור הגלילית": "צפון",
  "קרית שמונה": "צפון",
  "מירון": "צפון",
  "צפת": "צפון",
  "סכנין": "צפון",
  // ━━ מרכז ━━
  "נתניה": "מרכז",
  "הרצליה": "מרכז",
  "הוד השרון": "מרכז",
  "כפר סבא": "מרכז",
  "רעננה": "מרכז",
  "רמת השרון": "מרכז",
  "תל אביב": "מרכז",
  // Google's own name for it (the address picker, 2026-10-18).
  "תל אביב-יפו": "מרכז",
  "רמת גן": "מרכז",
  "גבעתיים": "מרכז",
  "בני ברק": "מרכז",
  "חולון": "מרכז",
  "בת ים": "מרכז",
  "ראשון לציון": "מרכז",
  "פתח תקווה": "מרכז",
  "ראש העין": "מרכז",
  "קרית אונו": "מרכז",
  "רמלה": "מרכז",
  "לוד": "מרכז",
  "נס ציונה": "מרכז",
  "רחובות": "מרכז",
  "יבנה": "מרכז",
  "יד בנימין": "מרכז",
  "מודיעין": "מרכז",
  "מודיעין מכבים רעות": "מרכז",
  "מבוא חורון": "מרכז",
  "מודיעין עילית": "מרכז",
  "אריאל": "מרכז",
  "אלעד": "מרכז",
  'כפר חב"ד': "מרכז",
  "ירושלים": "מרכז",
  "מבשרת ציון": "מרכז",
  "גבעת זאב": "מרכז",
  "כוכב יעקב": "מרכז",
  "הר אדר": "מרכז",
  "מעלה אדומים": "מרכז",
  "טלזסטון": "מרכז",
  "קרית יערים": "מרכז",
  "בית שמש": "מרכז",
  "אפרת": "מרכז",
  "אלון שבות": "מרכז",
  "ביתר עילית": "מרכז",
  "קרית ספר": "מרכז",
  "נווה דניאל": "מרכז",
  "כפר עציון": "מרכז",
  "עלי": "מרכז",
  // ━━ דרום ━━
  "אשדוד": "דרום",
  "אשקלון": "דרום",
  "קרית גת": "דרום",
  "אלומה": "דרום",
  "קרית מלאכי": "דרום",
  "שדרות": "דרום",
  "נתיבות": "דרום",
  "אופקים": "דרום",
  "באר שבע": "דרום",
  "דימונה": "דרום",
  "ערד": "דרום",
  "אילת": "דרום",
};

export function getCityRegion(city: string | null | undefined): DeliveryRegion | null {
  if (!city) return null;
  return CITY_REGION_MAP[city.trim()] ?? null;
}

// Every spelling of "unknown" on file (customers, 2026-10-15).
const UNKNOWN_PLACE = new Set(["לא ידוע", "לא-ידוע", "לא ידועה", "לא יודע", "ל ידוע"]);
const isUnknownPlace = (value: string) => UNKNOWN_PLACE.has(value.trim());

const isBlankAddressPart = (value: string) =>
  !value || value === "-" || value === "ללא עיר" || isUnknownPlace(value);

/** A town name on its own — "בית שמש" saved as the whole address is a city, not a street. */
const KNOWN_PLACES = new Set<string>([...CITY_OPTIONS.filter((c) => c !== "אחר"), ...Object.keys(CITY_REGION_MAP)]);

// Street-type words that already stand in for "רחוב" — don't prefix these.
const STREET_TYPE_PREFIX = /^(רחוב|רח['׳]|שדרות|שד['׳]|דרך|סמט|שכ|כיכר|ככר|מושב|קיבוץ|כביש|נתיב)/;

/**
 * Compose a delivery address as "רחוב <street>, <city>" — street first, then
 * city, prefixing "רחוב" when the street name has no street-type word of its
 * own. Addresses are stored "city | street", which we split apart. Shared by
 * the deliveries cards and the shareable delivery image so both read alike.
 */
/**
 * A town at the start, followed by a comma or by more words: "ירושלים, הרצל 5",
 * "בית שמש רמה ג". Not "ירושלים 5" — that's a street named after the town.
 * Longest name first, so "מודיעין עילית" wins over "מודיעין".
 */
const PLACES_LONGEST_FIRST = [...KNOWN_PLACES].sort((a, b) => b.length - a.length);
function leadingPlace(raw: string): string | null {
  for (const place of PLACES_LONGEST_FIRST) {
    if (!raw.startsWith(place)) continue;
    const rest = raw.slice(place.length);
    if (/^\s*,/.test(rest) || /^\s+[^\d\s]/.test(rest)) return place;
  }
  return null;
}

function splitDeliveryAddress(input: {
  address?: string | null;
  city?: string | null;
}): { street: string; city: string } {
  const raw = (input.address ?? "").trim();
  let city = (input.city ?? "").trim();
  if (isBlankAddressPart(city)) city = "";
  let street = "";

  if (raw.includes("|")) {
    const segments = raw.split("|").map((part) => part.trim()).filter(Boolean);
    if (!city && segments[0] && !isBlankAddressPart(segments[0])) city = segments[0];
    street = segments
      .slice(1)
      .filter((part) => !isBlankAddressPart(part))
      .join(", ")
      .trim();
  } else if (city && raw.startsWith(city)) {
    street = raw.slice(city.length).replace(/^[\s,]+/, "").trim();
  } else if (!city && KNOWN_PLACES.has(raw)) {
    city = raw;
  } else if (!city && leadingPlace(raw)) {
    // "ירושלים, הרצל 5": the order page shows "city | street" with a comma.
    city = leadingPlace(raw)!;
    street = raw.slice(city.length).replace(/^[\s,]+/, "").trim();
  } else if (!isBlankAddressPart(raw)) {
    // "-" is what the deliveries loader puts for no address at all.
    street = raw;
  }

  // Guard against a duplicated city trailing the street segment.
  if (city && street.endsWith(city)) {
    street = street.slice(0, -city.length).replace(/[\s,]+$/, "").trim();
  }
  return { street, city };
}

export function formatDeliveryAddress(input: {
  address?: string | null;
  city?: string | null;
  /** The apartment / entrance / floor typed in the address picker's own box. */
  unit?: string | null;
}): string {
  const { street, city } = splitDeliveryAddress(input);
  const shown = street && !STREET_TYPE_PREFIX.test(street) ? `רחוב ${street}` : street;
  const main = [shown, city].filter(Boolean).join(", ");
  return [main, input.unit?.trim()].filter(Boolean).join(" · ");
}

// A street and its house number, with at most a letter after it ("14ב",
// "14 ב") — nothing else. "יחזקאל הנביא 27 בחניה" isn't one.
const CLEAR_STREET = /^[^\d|,()/]+?\s*\d+(?:\s?[א-ת])?$/;

/** "הרצל 5, ירושלים" / "הרצל 5 ירושלים" → "הרצל 5": a town at the end is fine. */
function withoutTrailingPlace(street: string): string {
  for (const place of KNOWN_PLACES) {
    if (!street.endsWith(place)) continue;
    const before = street.slice(0, -place.length);
    if (/[\s,]$/.test(before)) return before.replace(/[\s,]+$/, "");
  }
  return street;
}

/**
 * Whether Waze can be trusted with this address (owner, 2026-10-15/16):
 * - "clear": a street and house number, with or without the city — navigate.
 * - "unclear": a street, but no number or words after it ("27 בחניה",
 *   "דירה 5", "קניון רמות קומה 2 …"). Waze guessed and sent drivers to the
 *   wrong place, so it's blocked until the address is saved properly.
 * - "none": a city alone, "לא ידוע", or nothing.
 */
export type AddressQuality = "none" | "unclear" | "clear";

export function addressQuality(input: { address?: string | null; city?: string | null }): AddressQuality {
  const { street } = splitDeliveryAddress(input);
  if (!street) return "none";
  return CLEAR_STREET.test(withoutTrailingPlace(street)) ? "clear" : "unclear";
}

/**
 * The city an order goes to. A branch order goes to the branch (owner,
 * 2026-10-16: "branch order should use the city just like the orders"), but
 * a branch's address is free text that usually names no city ("שמואל הנביא
 * 52") — then the branch is taken to be in the customer's own city.
 */
export function orderCity(input: {
  branchAddress?: string | null;
  customerAddress?: string | null;
  customerCity?: string | null;
}): string | null {
  const branchCity = input.branchAddress?.trim() ? splitDeliveryAddress({ address: input.branchAddress }).city : "";
  if (branchCity) return branchCity;
  const fromAddress = splitDeliveryAddress({ address: input.customerAddress }).city;
  if (fromAddress) return fromAddress;
  // The views' customer_city is the text before "|", so an address with no
  // "|" ("זכריה הרופא 14") comes through as its "city": not one with a number.
  const own = (input.customerCity ?? "").trim();
  return own && !isBlankAddressPart(own) && !/\d/.test(own) ? own : null;
}

/** What's saved, readable and ready to copy: "יחזקאל הנביא 27 בחניה, בית שמש". */
export function plainAddress(input: { address?: string | null; city?: string | null }): string {
  const { street, city } = splitDeliveryAddress(input);
  return [street, city].filter(Boolean).join(", ");
}

/**
 * A place we don't actually know. Some customer rows literally store "לא ידוע"
 * as the city OR as the address, which is worse than showing nothing: it spends
 * a line (and a Waze link that goes nowhere) to say we have no data. Returns
 * null for those and for blanks, so callers can just skip rendering.
 */
export function omitUnknownPlace(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  if (isUnknownPlace(trimmed)) return null;
  return trimmed;
}
