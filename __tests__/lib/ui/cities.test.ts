import { describe, it, expect } from "vitest";
import { getCityRegion, addressQuality, formatDeliveryAddress, omitUnknownPlace, plainAddress } from "@/lib/ui/cities";

describe("getCityRegion", () => {
  it("looks up a known city's delivery region", () => {
    expect(getCityRegion("באר שבע")).toBe("דרום");
  });
  it("trims the city before lookup", () => {
    expect(getCityRegion("  באר שבע  ")).toBe("דרום");
  });
  it("null for an unknown city or no city", () => {
    expect(getCityRegion("עיר לא קיימת")).toBeNull();
    expect(getCityRegion(null)).toBeNull();
    expect(getCityRegion(undefined)).toBeNull();
    expect(getCityRegion("")).toBeNull();
  });
});

describe("omitUnknownPlace", () => {
  it("passes a real value through, trimmed", () => {
    expect(omitUnknownPlace("  הרצל 5  ")).toBe("הרצל 5");
  });
  it("null for every 'unknown' spelling on file, and for blanks", () => {
    expect(omitUnknownPlace("לא ידוע")).toBeNull();
    expect(omitUnknownPlace("לא-ידוע")).toBeNull();
    expect(omitUnknownPlace("לא ידועה")).toBeNull();
    expect(omitUnknownPlace("")).toBeNull();
    expect(omitUnknownPlace("   ")).toBeNull();
    expect(omitUnknownPlace(null)).toBeNull();
    expect(omitUnknownPlace(undefined)).toBeNull();
  });
});

describe("formatDeliveryAddress", () => {
  it("splits a pipe-separated 'city | street' address and prefixes רחוב", () => {
    expect(formatDeliveryAddress({ address: "תל אביב | הרצל 5", city: null })).toBe("רחוב הרצל 5, תל אביב");
  });

  it("doesn't double-prefix a street that already names its own type (כיכר/שדרות/...)", () => {
    expect(formatDeliveryAddress({ address: "תל אביב | שדרות רוטשילד 1", city: null })).toBe(
      "שדרות רוטשילד 1, תל אביב"
    );
  });

  it("strips a leading city name from a non-piped address that starts with it", () => {
    expect(formatDeliveryAddress({ address: "תל אביב הרצל 5", city: "תל אביב" })).toBe("רחוב הרצל 5, תל אביב");
  });

  it("strips a TRAILING duplicated city from the street instead of re-adding it", () => {
    expect(formatDeliveryAddress({ address: "רחוב דיזנגוף 10, תל אביב", city: "תל אביב" })).toBe(
      "רחוב דיזנגוף 10, תל אביב"
    );
  });

  it("an address that's just the city name (no street) shows the city alone", () => {
    expect(formatDeliveryAddress({ address: "תל אביב", city: "תל אביב" })).toBe("תל אביב");
  });

  it("no city known: the whole address is treated as the street", () => {
    expect(formatDeliveryAddress({ address: "כיכר רבין", city: null })).toBe("כיכר רבין");
  });

  it("blank/'-'/'ללא עיר' city values are treated the same as no city", () => {
    expect(formatDeliveryAddress({ address: "הרצל 5", city: "-" })).toBe("רחוב הרצל 5");
    expect(formatDeliveryAddress({ address: "הרצל 5", city: "ללא עיר" })).toBe("רחוב הרצל 5");
  });

  it("empty address and city both blank returns an empty string", () => {
    expect(formatDeliveryAddress({ address: "", city: "" })).toBe("");
  });

  it("a known city saved as the whole address is the city, not 'רחוב <city>'", () => {
    expect(formatDeliveryAddress({ address: "בית שמש", city: null })).toBe("בית שמש");
  });

  it("'לא ידוע' is never shown as a street or a city", () => {
    expect(formatDeliveryAddress({ address: "לא ידוע", city: "" })).toBe("");
    expect(formatDeliveryAddress({ address: "לא ידוע | נחמיה 14", city: null })).toBe("רחוב נחמיה 14");
    expect(formatDeliveryAddress({ address: "בית שמש | לא ידוע", city: null })).toBe("בית שמש");
  });
});

describe("addressQuality", () => {
  it("clear: a street and house number, with or without the town", () => {
    expect(addressQuality({ address: "בית שמש | יחזקאל הנביא 27", city: "בית שמש" })).toBe("clear");
    expect(addressQuality({ address: "ירושלים | שמגר 14 ב", city: null })).toBe("clear");
    expect(addressQuality({ address: "ירושלים | רח רייכמאן 36", city: null })).toBe("clear");
    expect(addressQuality({ address: "זכריה הרופא 14", city: null })).toBe("clear");
    expect(addressQuality({ address: "סורוצקין 1 ירושלים", city: null })).toBe("clear");
    expect(addressQuality({ address: "בן איש חי11", city: null })).toBe("clear");
    // The order page's "city | street" shown as "city, street".
    expect(addressQuality({ address: "ירושלים, הרצל 5", city: null })).toBe("clear");
    expect(addressQuality({ address: "מודיעין עילית, אבני נזר 3", city: null })).toBe("clear");
    expect(plainAddress({ address: "בית שמש, יחזקאל הנביא 27", city: null })).toBe("יחזקאל הנביא 27, בית שמש");
  });

  it("unclear: words after the number, or no number at all", () => {
    expect(addressQuality({ address: "בית שמש | יחזקאל הנביא 27 בחניה", city: "בית שמש" })).toBe("unclear");
    expect(addressQuality({ address: "הר יונה | האדמו\"ר מבעלז 26 דירה 1", city: "הר יונה" })).toBe("unclear");
    expect(addressQuality({ address: "ירושלים | קניון רמות קומה 2  שדרות גולדה מאיר 255", city: null })).toBe("unclear");
    expect(addressQuality({ address: "ירושלים | רמות", city: null })).toBe("unclear");
    expect(addressQuality({ address: "בית שמש, יחזקאל הנביא 27 בחניה", city: null })).toBe("unclear");
    expect(addressQuality({ address: "כיכר רבין", city: null })).toBe("unclear");
  });

  it("none: a city alone, 'לא ידוע', or nothing", () => {
    expect(addressQuality({ address: "בית שמש", city: null })).toBe("none");
    expect(addressQuality({ address: "ירושלים", city: "ירושלים" })).toBe("none");
    expect(addressQuality({ address: "ירושלים | ירושלים", city: null })).toBe("none");
    expect(addressQuality({ address: null, city: "אלעד" })).toBe("none");
    expect(addressQuality({ address: "לא ידוע", city: "" })).toBe("none");
    expect(addressQuality({ address: "לא יודע", city: null })).toBe("none");
    expect(addressQuality({ address: "בית שמש | לא ידוע", city: null })).toBe("none");
    expect(addressQuality({ address: "", city: "" })).toBe("none");
    // The deliveries loader's stand-in for no address.
    expect(addressQuality({ address: "-", city: "" })).toBe("none");
    expect(formatDeliveryAddress({ address: "-", city: "" })).toBe("");
    expect(addressQuality({ address: null, city: null })).toBe("none");
  });
});

describe("plainAddress", () => {
  it("street then town, no pipe and no added 'רחוב'", () => {
    expect(plainAddress({ address: "בית שמש | יחזקאל הנביא 27 בחניה", city: "בית שמש" })).toBe(
      "יחזקאל הנביא 27 בחניה, בית שמש"
    );
    expect(plainAddress({ address: "בית שמש", city: null })).toBe("בית שמש");
    expect(plainAddress({ address: "לא ידוע", city: "" })).toBe("");
  });
});
