// One address shape for every place BizH keeps an address: a customer, a
// branch, a move's from/to, a task, a property (owner, 2026-10-16: "all the
// addresses need to always be saved in the same format … so that when we
// search for a global address, we could always find the address").
//
// It's picked from Google's list (components/ui/address-picker.tsx), so the
// city, street and house number come apart cleanly and carry the exact map
// point, which is what Waze is sent. The words that aren't the address
// ("דירה 5", "כניסה א") have their own `unit`.

export type StructuredAddress = {
  /** "בית שמש". Empty only when Google gave no town. */
  city: string;
  /** "יחזקאל הנביא". Empty for a settlement picked on its own ("מושב אלומה"). */
  street: string;
  /** "27", "14ב". Empty when only a street or a settlement was picked. */
  houseNumber: string;
  /** Typed by hand: apartment, entrance, floor ("דירה 5, כניסה א"). */
  unit: string;
  /** Google's point for the address. */
  lat: number | null;
  lng: number | null;
  /** Google's id for the place, to look it up again. */
  placeId: string | null;
  /** Google's own line, "יחזקאל הנביא 27, בית שמש". */
  formatted: string;
};

export const EMPTY_ADDRESS: StructuredAddress = {
  city: "",
  street: "",
  houseNumber: "",
  unit: "",
  lat: null,
  lng: null,
  placeId: null,
  formatted: "",
};

/** A street and its number in a town: somewhere a driver can go. */
export function isFullAddress(address: StructuredAddress | null | undefined): boolean {
  return Boolean(address && address.city.trim() && address.street.trim() && address.houseNumber.trim());
}

/**
 * Every customer has a city, address or not (owner, 2026-10-18: "even if there
 * is no address for some customers still every single one needs a city — we
 * need it for stuff"). The city a customer form would save: the picked
 * address's, else (an untouched address saved before the picker) the city it
 * already has. Empty means the form must ask for one.
 */
export function customerCityToSave(input: {
  picked: StructuredAddress | null;
  touched: boolean;
  savedCity: string | null | undefined;
}): string {
  if (input.touched || input.picked) return input.picked?.city.trim() ?? "";
  return (input.savedCity ?? "").trim();
}

/** "יחזקאל הנביא 27" */
export function streetLine(address: StructuredAddress): string {
  return [address.street.trim(), address.houseNumber.trim()].filter(Boolean).join(" ");
}

/** "יחזקאל הנביא 27, בית שמש" — and the unit after it when there is one. */
export function addressLine(address: StructuredAddress, { withUnit = true }: { withUnit?: boolean } = {}): string {
  const main = [streetLine(address), address.city.trim()].filter(Boolean).join(", ");
  const unit = withUnit ? address.unit.trim() : "";
  return [main, unit].filter(Boolean).join(" · ");
}

/**
 * The old one-line format, "בית שמש | יחזקאל הנביא 27", still written beside
 * the new fields so everything that reads the old line keeps working until it
 * moves over (Waze, the driver's slip, invoices, search, the phone copy).
 */
export function legacyAddressLine(address: StructuredAddress): string | null {
  const city = address.city.trim();
  const street = streetLine(address);
  if (city && street) return `${city} | ${street}`;
  return city || street || null;
}

type GoogleComponent = { longText?: string; shortText?: string; types?: string[] };
export type GooglePlaceDetails = {
  id?: string;
  formattedAddress?: string;
  shortFormattedAddress?: string;
  addressComponents?: GoogleComponent[];
  location?: { latitude?: number; longitude?: number };
};

// Hebrew letters, digits and what a Hebrew place name is written with.
const HEBREW_NAME = /^[֐-׿0-9\s"'״׳\-–.()]+$/;
const HAS_HEBREW = /[א-ת]/;

/**
 * A place name from Google, Hebrew only (owner, 2026-10-18: "why isn't all
 * … only in Hebrew?"). Google Maps' own entry for a place can be broken: for
 * שדרות גולדה מאיר 255 its town came as "• ירושלים, القدس, Jerusalem,
 * Yerushalayim, …" — every language at once — and was saved as the city. The
 * Hebrew part is kept ("ירושלים"); a name with no Hebrew in it is dropped.
 */
export function hebrewPlaceName(value: string | null | undefined): string {
  const parts = (value ?? "")
    // Vowel marks and direction marks Google sometimes adds ("רֵיקָנָטי").
    .replace(/[֑-ׇ‎‏‪-‮]/g, "")
    .split(/[,،|]/)
    .map((part) => part.replace(/[•·*▪●◦]/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const hebrew = parts.find((part) => HAS_HEBREW.test(part) && HEBREW_NAME.test(part) && part.length <= 60);
  return hebrew ?? "";
}

function component(components: GoogleComponent[], ...types: string[]): string {
  for (const type of types) {
    for (const hit of components.filter((c) => c.types?.includes(type))) {
      const name = hebrewPlaceName(hit.longText) || hebrewPlaceName(hit.shortText);
      if (name) return name;
    }
  }
  return "";
}

// "רח' יוסף שכטמן" is "יוסף שכטמן": the word for street isn't part of its name.
const STREET_WORD = /^(רחוב|רח['׳]|רח\.)\s+/;

/**
 * The street, house number and town from Google's own short line. Since
 * 2026-10-25 Google sends the parts in English even when asked for Hebrew
 * ("Beit Ha-Defus Street", "Jerusalem") while that line stays Hebrew ("בית
 * הדפוס 12, ירושלים"): "<street> <number>, <town>", "<street>, <town>", or a
 * settlement on its own. Google's parts, in any language, still say whether
 * the place has a street.
 */
function fromHebrewLine(line: string, components: GoogleComponent[]): { city: string; street: string; houseNumber: string } {
  const [first = "", ...rest] = line.split(",");
  const hasStreet = components.length > 0 ? components.some((c) => c.types?.includes("route")) : rest.length > 0;
  if (!hasStreet) return { city: hebrewPlaceName(line), street: "", houseNumber: "" };
  // The number is at the end: "בית הדפוס 12", "שמגר 14 ב".
  const name = hebrewPlaceName(first);
  const numbered = /^(.+?)\s+(\d\S*(?:\s[א-ת])?)$/.exec(name);
  return {
    city: hebrewPlaceName(rest.join(",")),
    street: (numbered?.[1] ?? name).replace(STREET_WORD, ""),
    houseNumber: numbered?.[2] ?? "",
  };
}

/**
 * Google's place → our shape. The town is the locality; a settlement Google
 * files under a council comes as administrative_area_level_2 or a sublocality.
 * Google's own line is kept without the country or the postcode.
 */
export function addressFromGooglePlace(place: GooglePlaceDetails): StructuredAddress {
  const components = place.addressComponents ?? [];
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  let city = component(components, "locality", "postal_town", "sublocality", "administrative_area_level_2");
  let street = component(components, "route").replace(STREET_WORD, "");
  let houseNumber = (components.find((c) => c.types?.includes("street_number"))?.longText ?? "").trim().slice(0, 20);
  const short = (place.shortFormattedAddress ?? "").trim();
  if (!city || !street) {
    // The parts came in English: their Hebrew names are in Google's own line.
    const line = fromHebrewLine(short, components);
    city ||= line.city;
    if (!street && line.street) {
      street = line.street;
      houseNumber ||= line.houseNumber.slice(0, 20);
    }
  }
  // Google's own line only when it's all Hebrew; else built from the parts.
  const ownLine =
    short && !/[֑-ׇ‎‏]|^(רחוב|רח['׳])\s/.test(short) && short.split(",").every((part) => HEBREW_NAME.test(part.trim()))
      ? short
      : "";
  const formatted = ownLine || [[street, houseNumber].filter(Boolean).join(" "), city].filter(Boolean).join(", ");
  return {
    city,
    street,
    houseNumber,
    unit: "",
    lat: typeof lat === "number" && Number.isFinite(lat) ? lat : null,
    lng: typeof lng === "number" && Number.isFinite(lng) ? lng : null,
    placeId: place.id ?? null,
    formatted,
  };
}
