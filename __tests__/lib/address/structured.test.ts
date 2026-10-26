import { describe, expect, it } from "vitest";
import {
  hebrewPlaceName,
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

describe("a broken Google entry (owner, 2026-10-18: \"why isn't all … only in Hebrew?\")", () => {
  // What Google sent for שדרות גולדה מאיר 255, ירושלים: its town in every language at once.
  const BROKEN = "• ירושלים, القدس, Jerusalem, Yerushalayim, أورشليم, י-ם, जेरूसलम, జేరుసలం, Ерусалим, Jeruzalém, Jérusalem";

  it("keeps only the Hebrew name of the town, and builds a Hebrew line", () => {
    const a = addressFromGooglePlace({
      id: "ChIJa6DLFAvWAhURBbxiDq4gJvI",
      shortFormattedAddress: `שדרות גולדה מאיר 255, ${BROKEN}`,
      addressComponents: [
        { longText: "255", types: ["street_number"] },
        { longText: "שדרות גולדה מאיר", types: ["route"] },
        { longText: BROKEN, shortText: BROKEN, types: ["locality", "political"] },
      ],
      location: { latitude: 31.8177725, longitude: 35.1944093 },
    });
    expect(a).toMatchObject({ city: "ירושלים", street: "שדרות גולדה מאיר", houseNumber: "255", formatted: "שדרות גולדה מאיר 255, ירושלים" });
  });

  it("hebrewPlaceName: the Hebrew part, or nothing", () => {
    expect(hebrewPlaceName(BROKEN)).toBe("ירושלים");
    expect(hebrewPlaceName("תל אביב-יפו")).toBe("תל אביב-יפו");
    expect(hebrewPlaceName('האדמו"ר מבעלזא')).toBe('האדמו"ר מבעלזא');
    expect(hebrewPlaceName("Jerusalem")).toBe("");
    expect(hebrewPlaceName(null)).toBe("");
  });

  it("a name with no Hebrew falls back to the next one Google gave", () => {
    const a = addressFromGooglePlace({
      addressComponents: [
        { longText: "Beit Shemesh", types: ["locality"] },
        { longText: "בית שמש", types: ["administrative_area_level_2"] },
      ],
    });
    expect(a.city).toBe("בית שמש");
  });
});

describe("Google's parts in English (2026-10-26: new picks lost their street and city)", () => {
  // What Google Places (New) sent for these on 2026-10-26, asked with languageCode=he.
  const BEIT_HADEFUS = {
    id: "ChIJ-beit-hadefus",
    shortFormattedAddress: "בית הדפוס 12, ירושלים",
    addressComponents: [
      { longText: "12", types: ["street_number"] },
      { longText: "Beit Ha-Defus Street", shortText: "Beit Ha-Defus St", types: ["route"] },
      { longText: "Jerusalem", types: ["locality", "political"] },
      { longText: "Jerusalem District", types: ["administrative_area_level_1", "political"] },
      { longText: "Israel", shortText: "IL", types: ["country", "political"] },
    ],
    location: { latitude: 31.7849, longitude: 35.1857 },
  };
  const HAHAGANA_STREET = {
    shortFormattedAddress: "ההגנה, רחובות",
    addressComponents: [
      { longText: "Ha-Hagana Street", shortText: "Ha-Hagana St", types: ["route"] },
      { longText: "Rehovot", types: ["locality", "political"] },
      { longText: "Israel", shortText: "IL", types: ["country", "political"] },
    ],
  };

  it("street, number and city from Google's Hebrew line", () => {
    expect(addressFromGooglePlace(BEIT_HADEFUS)).toEqual({
      city: "ירושלים",
      street: "בית הדפוס",
      houseNumber: "12",
      unit: "",
      lat: 31.7849,
      lng: 35.1857,
      placeId: "ChIJ-beit-hadefus",
      formatted: "בית הדפוס 12, ירושלים",
    });
    expect(isFullAddress(addressFromGooglePlace(BEIT_HADEFUS))).toBe(true);
  });

  it("a street with no number: street and city, the number still to ask", () => {
    expect(addressFromGooglePlace(HAHAGANA_STREET)).toMatchObject({ city: "רחובות", street: "ההגנה", houseNumber: "" });
  });

  it("a settlement on its own", () => {
    const a = addressFromGooglePlace({
      shortFormattedAddress: "אלומה",
      addressComponents: [
        { longText: "Aluma", types: ["locality", "political"] },
        { longText: "Israel", shortText: "IL", types: ["country", "political"] },
      ],
    });
    expect(a).toMatchObject({ city: "אלומה", street: "", houseNumber: "", formatted: "אלומה" });
  });

  it("no 'רח'' in front and no vowel marks, and the line built from the parts", () => {
    const a = addressFromGooglePlace({
      shortFormattedAddress: "רח' אַבְרָהָם רֵיקָנָטי 60, ירושלים",
      addressComponents: [
        { longText: "60", types: ["street_number"] },
        { longText: "Avraham Rekanati Street", types: ["route"] },
        { longText: "Jerusalem", types: ["locality", "political"] },
      ],
    });
    expect(a).toMatchObject({ street: "אברהם ריקנטי", houseNumber: "60", city: "ירושלים", formatted: "אברהם ריקנטי 60, ירושלים" });
  });

  it("a number with a letter after a space, as Google writes some", () => {
    const a = addressFromGooglePlace({
      shortFormattedAddress: "שמגר 14 ב, ירושלים",
      addressComponents: [
        { longText: "14 ב", types: ["street_number"] },
        { longText: "Shamgar Street", types: ["route"] },
        { longText: "Jerusalem", types: ["locality", "political"] },
      ],
    });
    expect(a).toMatchObject({ street: "שמגר", houseNumber: "14 ב", city: "ירושלים" });
  });

  it("with no parts at all, the number is the end of the street", () => {
    expect(addressFromGooglePlace({ shortFormattedAddress: "בית הדפוס 12, ירושלים" })).toMatchObject({
      street: "בית הדפוס",
      houseNumber: "12",
      city: "ירושלים",
    });
  });

  it("Hebrew parts, when Google sends them, still win over the line", () => {
    const a = addressFromGooglePlace({ ...YECHEZKEL, shortFormattedAddress: "יחזקאל 27, רמת בית שמש" });
    expect(a).toMatchObject({ street: "יחזקאל הנביא", houseNumber: "27", city: "בית שמש" });
  });

  it("only the missing one comes from the line", () => {
    const a = addressFromGooglePlace({
      shortFormattedAddress: "ההגנה 29, רחובות",
      addressComponents: [
        { longText: "29", types: ["street_number"] },
        { longText: "Ha-Hagana Street", types: ["route"] },
        { longText: "רחובות", types: ["locality", "political"] },
      ],
    });
    expect(a).toMatchObject({ street: "ההגנה", houseNumber: "29", city: "רחובות" });
  });

  it("an English line too: no names made up", () => {
    const a = addressFromGooglePlace({ ...BEIT_HADEFUS, shortFormattedAddress: "Beit Ha-Defus St 12, Jerusalem" });
    expect(a).toMatchObject({ city: "", street: "" });
  });
});

describe("Google's names, tidied", () => {
  it("no vowel marks, no 'רח'' in front, and the line built from the parts", () => {
    const a = addressFromGooglePlace({
      shortFormattedAddress: "רח' אַבְרָהָם רֵיקָנָטי 60, ירושלים",
      addressComponents: [
        { longText: "60", types: ["street_number"] },
        { longText: "רח' אַבְרָהָם רֵיקָנָטי", types: ["route"] },
        { longText: "ירושלים", types: ["locality"] },
      ],
    });
    expect(a).toMatchObject({ street: "אברהם ריקנטי", houseNumber: "60", city: "ירושלים", formatted: "אברהם ריקנטי 60, ירושלים" });
  });

  it("keeps a 'שדרות' — that one is part of the name", () => {
    const a = addressFromGooglePlace({ addressComponents: [{ longText: "שדרות רבי יהודה הנשיא", types: ["route"] }] });
    expect(a.street).toBe("שדרות רבי יהודה הנשיא");
  });
});
