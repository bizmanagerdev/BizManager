// Google Places (New), asked from BizH's server only: the key
// (GOOGLE_PLACES_API_KEY) never reaches a browser or a phone. The address
// picker calls /api/places/autocomplete as someone types and
// /api/places/details for the one they pick.
//
// Billing (2026-10): suggestions and the picked place share a session token,
// so a session is up to 12 billed suggestion calls plus one Place Details
// Essentials call — 10,000 of each free a month, far above what BizH types.

import { addressFromGooglePlace, hebrewPlaceName, type GooglePlaceDetails, type StructuredAddress } from "@/lib/address/structured";

const BASE = "https://places.googleapis.com/v1";

/** What a suggestion is, so the picker knows what picking it gives. */
export type SuggestionKind = "address" | "street" | "settlement";

export type AddressSuggestion = {
  placeId: string;
  /** "יחזקאל הנביא 27" */
  main: string;
  /** "בית שמש, ישראל" */
  secondary: string;
  kind: SuggestionKind;
};

export class PlacesError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export function isPlacesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key) throw new PlacesError("חיפוש כתובות לא מוגדר בשרת (GOOGLE_PLACES_API_KEY).", 503);
  return key;
}

function kindOf(types: string[] | undefined): SuggestionKind {
  const t = types ?? [];
  if (t.includes("street_address") || t.includes("premise") || t.includes("subpremise")) return "address";
  if (t.includes("route")) return "street";
  return "settlement";
}

async function googleError(res: Response): Promise<PlacesError> {
  const body = (await res.json().catch(() => null)) as { error?: { status?: string; message?: string } } | null;
  // Logged for us; the person typing gets a plain sentence.
  console.error("[places] google", res.status, body?.error?.status, body?.error?.message);
  return new PlacesError("חיפוש הכתובות לא זמין כרגע. נסו שוב בעוד רגע.", 502);
}

export async function autocompleteAddresses(input: string, sessionToken: string): Promise<AddressSuggestion[]> {
  const res = await fetch(`${BASE}/places:autocomplete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey() },
    body: JSON.stringify({
      input,
      sessionToken,
      languageCode: "he",
      // "ps" too: Google files ביתר עילית, מודיעין עילית, קרית ספר and the
      // other towns over the green line under it — with "il" alone they were
      // never offered (found matching the saved addresses, 2026-10-18).
      includedRegionCodes: ["il", "ps"],
      // Addresses and streets, and a settlement on its own for a moshav or a
      // kibbutz that has no street names.
      includedPrimaryTypes: ["street_address", "premise", "subpremise", "route", "locality"],
    }),
    cache: "no-store",
  });
  if (!res.ok) throw await googleError(res);
  const body = (await res.json()) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        text?: { text?: string };
        structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
        types?: string[];
      };
    }>;
  };
  return (body.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .map((p) => ({
      placeId: p.placeId!,
      main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
      // The list shows only the Hebrew of it (a broken Google entry can carry every language).
      secondary: (p.structuredFormat?.secondaryText?.text ?? "")
        .split(",")
        .map((part) => hebrewPlaceName(part))
        .filter(Boolean)
        .join(", "),
      kind: kindOf(p.types),
    }))
    .filter((s) => s.main);
}

export async function addressForPlace(placeId: string, sessionToken: string | null): Promise<StructuredAddress> {
  const params = new URLSearchParams({ languageCode: "he", regionCode: "il" });
  if (sessionToken) params.set("sessionToken", sessionToken);
  const res = await fetch(`${BASE}/places/${encodeURIComponent(placeId)}?${params}`, {
    headers: {
      "X-Goog-Api-Key": apiKey(),
      // Essentials fields only: the address, its parts and its point.
      "X-Goog-FieldMask": "id,formattedAddress,shortFormattedAddress,addressComponents,location",
    },
    cache: "no-store",
  });
  if (!res.ok) throw await googleError(res);
  return addressFromGooglePlace((await res.json()) as GooglePlaceDetails);
}
