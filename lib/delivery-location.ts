// The saved drop-off pin: parsing one out of a pasted map link, and turning one
// back into a navigation link.
//
// Why a pin at all: deliveries navigate by the customer's address STRING, which
// is what makes Waze drop a driver at the wrong entrance, on the wrong side of a
// divided road, or at the building's registered address rather than the loading
// door. A stored coordinate removes the guess entirely.

export type DeliveryPin = { lat: number; lng: number };

/** Israel-ish sanity bounds — a pasted link from the wrong place is a typo, not data. */
const LAT_RANGE = [-90, 90] as const;
const LNG_RANGE = [-180, 180] as const;

function isValidPin(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= LAT_RANGE[0] &&
    lat <= LAT_RANGE[1] &&
    lng >= LNG_RANGE[0] &&
    lng <= LNG_RANGE[1] &&
    // 0,0 is the Atlantic — always a parse failure, never a real drop-off.
    !(lat === 0 && lng === 0)
  );
}

/**
 * Pull coordinates out of whatever the user pasted. Handles the shapes people
 * actually share from a phone:
 *   waze.com/ul?ll=31.7683,35.2137        waze://?ll=31.7683,35.2137
 *   google.com/maps/@31.7683,35.2137,17z  google.com/maps?q=31.7683,35.2137
 *   google.com/maps/place/.../@31.76,35.21,17z
 *   maps.app.goo.gl/... (short links can't be resolved client-side — see below)
 *   or a bare "31.7683, 35.2137" pasted from anywhere.
 *
 * Returns null when nothing coordinate-shaped is present, so the caller can say
 * so rather than silently saving a wrong location.
 */
export function parseMapLink(input: string): DeliveryPin | null {
  const text = input.trim();
  if (!text) return null;

  // Ordered most-specific first: `ll=` and `q=` are explicit, `@` is positional.
  const patterns = [
    /[?&]ll=(-?\d+(?:\.\d+)?)[,%2C\s]+(-?\d+(?:\.\d+)?)/i,
    // `query=` is what Google's own share links use — and what mapsLinkForPin
    // below emits, so without it a link we generated wouldn't parse back.
    /[?&]query=(-?\d+(?:\.\d+)?)[,%2C\s]+(-?\d+(?:\.\d+)?)/i,
    /[?&]q=(-?\d+(?:\.\d+)?)[,%2C\s]+(-?\d+(?:\.\d+)?)/i,
    /[?&]latlng=(-?\d+(?:\.\d+)?)[,%2C\s]+(-?\d+(?:\.\d+)?)/i,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (isValidPin(lat, lng)) return { lat, lng };
  }
  return null;
}

/**
 * True for a shortened map link. These redirect server-side, so the coordinates
 * simply aren't in the string — worth telling the user instead of "invalid link".
 */
export function isShortenedMapLink(input: string): boolean {
  return /(maps\.app\.goo\.gl|goo\.gl\/maps|waze\.com\/ul\/h)/i.test(input.trim());
}

/** Navigate straight to the saved pin. */
export function wazeLinkForPin(pin: DeliveryPin): string {
  return `https://waze.com/ul?ll=${pin.lat},${pin.lng}&navigate=yes`;
}

/** Google Maps fallback, for anyone who doesn't use Waze. */
export function mapsLinkForPin(pin: DeliveryPin): string {
  return `https://www.google.com/maps/search/?api=1&query=${pin.lat},${pin.lng}`;
}

/** Build a pin from stored columns, or null when the customer has none saved. */
export function pinFrom(lat: unknown, lng: unknown): DeliveryPin | null {
  const latitude = typeof lat === "number" ? lat : Number(lat);
  const longitude = typeof lng === "number" ? lng : Number(lng);
  if (lat === null || lng === null || lat === undefined || lng === undefined) return null;
  return isValidPin(latitude, longitude) ? { lat: latitude, lng: longitude } : null;
}

/** Short human-readable form, for showing what's saved. */
export function formatPin(pin: DeliveryPin): string {
  return `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`;
}
