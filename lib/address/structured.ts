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

function component(components: GoogleComponent[], ...types: string[]): string {
  for (const type of types) {
    const hit = components.find((c) => c.types?.includes(type));
    if (hit?.longText?.trim()) return hit.longText.trim();
  }
  return "";
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
  const city = component(components, "locality", "postal_town", "sublocality", "administrative_area_level_2");
  const street = component(components, "route");
  const houseNumber = component(components, "street_number");
  const formatted =
    (place.shortFormattedAddress ?? "").trim() ||
    [[street, houseNumber].filter(Boolean).join(" "), city].filter(Boolean).join(", ");
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
