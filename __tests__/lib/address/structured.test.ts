import { describe, expect, it } from "vitest";
import {
  addressFromGooglePlace,
  addressLine,
  EMPTY_ADDRESS,
  isFullAddress,
  legacyAddressLine,
} from "@/lib/address/structured";

// What Google Places (New) actually sent for these, 2026-10-18.
const YECHEZKEL = {
  id: "ChIJ-yechezkel",
  shortFormattedAddress: "יחזקאל הנביא 27, בית שמש",
  addressComponents: [
    { longText: "27", types: ["street_number"] },
    { longText: "יחזקאל הנביא", types: ["route"] },
    { longText: "בית שמש", types: ["locality", "political"] },
    { longText: "מחוז ירושלים", types: ["administrative_area_level_1", "political"] },
    { longText: "ישראל", shortText: "IL", types: ["country", "political"] },
  ],
  location: { latitude: 31.7037704, longitude: 34.9863334 },
};
const CHAZON_ISH_STREET = {
  id: "ChIJ-chazon",
  shortFormattedAddress: "חזון איש, רחובות",
  addressComponents: [
    { longText: "חזון איש", types: ["route"] },
    { longText: "רחובות", types: ["locality", "political"] },
    { longText: "רחובות", types: ["administrative_area_level_2", "political"] },
  ],
  location: { latitude: 31.88, longitude: 34.79 },
};
const SETTLEMENT = {
  id: "ChIJ-aluma",
  shortFormattedAddress: "אלומה",
  addressComponents: [{ longText: "אלומה", types: ["administrative_area_level_2", "political"] }],
  location: { latitude: 31.66, longitude: 34.72 },
};

describe("addressFromGooglePlace", () => {
  it("takes the city, street, house number and point apart", () => {
    expect(addressFromGooglePlace(YECHEZKEL)).toEqual({
      city: "בית שמש",
      street: "יחזקאל הנביא",
      houseNumber: "27",
      unit: "",
      lat: 31.7037704,
      lng: 34.9863334,
      placeId: "ChIJ-yechezkel",
      formatted: "יחזקאל הנביא 27, בית שמש",
    });
  });

  it("a street with no number, and a settlement under a council", () => {
    expect(addressFromGooglePlace(CHAZON_ISH_STREET)).toMatchObject({ city: "רחובות", street: "חזון איש", houseNumber: "" });
    expect(addressFromGooglePlace(SETTLEMENT)).toMatchObject({ city: "אלומה", street: "", houseNumber: "" });
  });

  it("no point and no line from Google: none made up", () => {
    const a = addressFromGooglePlace({ addressComponents: YECHEZKEL.addressComponents });
    expect(a.lat).toBeNull();
    expect(a.placeId).toBeNull();
    expect(a.formatted).toBe("יחזקאל הנביא 27, בית שמש");
  });
});

describe("the address's lines", () => {
  const picked = { ...addressFromGooglePlace(YECHEZKEL), unit: "בחניה" };

  it("full only with a street and number in a town", () => {
    expect(isFullAddress(picked)).toBe(true);
    expect(isFullAddress(addressFromGooglePlace(CHAZON_ISH_STREET))).toBe(false);
    expect(isFullAddress(addressFromGooglePlace(SETTLEMENT))).toBe(false);
    expect(isFullAddress(null)).toBe(false);
  });

  it("reads street first, then the town, then the unit", () => {
    expect(addressLine(picked)).toBe("יחזקאל הנביא 27, בית שמש · בחניה");
    expect(addressLine(picked, { withUnit: false })).toBe("יחזקאל הנביא 27, בית שמש");
  });

  it("the old one-line format keeps the unit out", () => {
    expect(legacyAddressLine(picked)).toBe("בית שמש | יחזקאל הנביא 27");
    expect(legacyAddressLine(addressFromGooglePlace(SETTLEMENT))).toBe("אלומה");
    expect(legacyAddressLine(EMPTY_ADDRESS)).toBeNull();
  });
});
