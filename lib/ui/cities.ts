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
  "מודיעין": "מרכז",
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

const isBlankAddressPart = (value: string) => !value || value === "-" || value === "ללא עיר";

// Street-type words that already stand in for "רחוב" — don't prefix these.
const STREET_TYPE_PREFIX = /^(רחוב|רח['׳]|שדרות|שד['׳]|דרך|סמט|שכ|כיכר|ככר|מושב|קיבוץ|כביש|נתיב)/;

/**
 * Compose a delivery address as "רחוב <street>, <city>" — street first, then
 * city, prefixing "רחוב" when the street name has no street-type word of its
 * own. Addresses are stored "city | street", which we split apart. Shared by
 * the deliveries cards and the shareable delivery image so both read alike.
 */
export function formatDeliveryAddress(input: {
  address?: string | null;
  city?: string | null;
}): string {
  const raw = (input.address ?? "").trim();
  let city = (input.city ?? "").trim();
  let street = "";

  if (raw.includes("|")) {
    const segments = raw.split("|").map((part) => part.trim()).filter(Boolean);
    if (isBlankAddressPart(city) && segments[0]) city = segments[0];
    street = segments.slice(1).join(", ").trim();
  } else if (!isBlankAddressPart(city) && raw.startsWith(city)) {
    street = raw.slice(city.length).replace(/^[\s,]+/, "").trim();
  } else if (!isBlankAddressPart(city) && raw === city) {
    street = "";
  } else {
    street = raw;
  }

  const cityClean = isBlankAddressPart(city) ? "" : city;
  // Guard against a duplicated city trailing the street segment.
  if (cityClean && street.endsWith(cityClean)) {
    street = street.slice(0, -cityClean.length).replace(/[\s,]+$/, "").trim();
  }
  if (street && !STREET_TYPE_PREFIX.test(street)) {
    street = `רחוב ${street}`;
  }

  return [street, cityClean].filter(Boolean).join(", ");
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
  if (trimmed === "לא ידוע" || trimmed === "לא-ידוע" || trimmed === "לא ידועה") return null;
  return trimmed;
}
