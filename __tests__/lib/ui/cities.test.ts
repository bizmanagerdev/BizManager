import { describe, it, expect } from "vitest";
import { getCityRegion, formatDeliveryAddress, omitUnknownPlace } from "@/lib/ui/cities";

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
});
