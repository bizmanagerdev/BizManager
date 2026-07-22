import { describe, expect, it } from "vitest";
import {
  formatPin,
  isShortenedMapLink,
  mapsLinkForPin,
  parseMapLink,
  pinFrom,
  wazeLinkForPin,
} from "@/lib/delivery-location";

describe("parseMapLink", () => {
  it("reads a Waze share link", () => {
    expect(parseMapLink("https://waze.com/ul?ll=31.7683,35.2137&navigate=yes")).toEqual({
      lat: 31.7683,
      lng: 35.2137,
    });
  });

  it("reads the waze:// app scheme", () => {
    expect(parseMapLink("waze://?ll=32.0853,34.7818")).toEqual({ lat: 32.0853, lng: 34.7818 });
  });

  it("reads a Google Maps @-style URL", () => {
    expect(parseMapLink("https://www.google.com/maps/@31.7683,35.2137,17z")).toEqual({
      lat: 31.7683,
      lng: 35.2137,
    });
  });

  it("reads a Google Maps place URL, taking the @ coordinates", () => {
    expect(
      parseMapLink("https://www.google.com/maps/place/Jerusalem/@31.7683,35.2137,15z/data=!3m1")
    ).toEqual({ lat: 31.7683, lng: 35.2137 });
  });

  it("reads a ?q= link", () => {
    expect(parseMapLink("https://maps.google.com/?q=31.25,34.79")).toEqual({ lat: 31.25, lng: 34.79 });
  });

  it("reads bare pasted coordinates", () => {
    expect(parseMapLink("31.7683, 35.2137")).toEqual({ lat: 31.7683, lng: 35.2137 });
  });

  it("handles negative coordinates", () => {
    expect(parseMapLink("-33.8688, 151.2093")).toEqual({ lat: -33.8688, lng: 151.2093 });
  });

  it("returns null for a link with no coordinates in it", () => {
    expect(parseMapLink("https://maps.app.goo.gl/AbCdEf123")).toBeNull();
  });

  it("returns null for empty or junk input", () => {
    expect(parseMapLink("")).toBeNull();
    expect(parseMapLink("   ")).toBeNull();
    expect(parseMapLink("רחוב הרצל 5")).toBeNull();
  });

  it("rejects 0,0 — always a parse failure, never a real drop-off", () => {
    expect(parseMapLink("0,0")).toBeNull();
  });

  it("rejects out-of-range coordinates", () => {
    expect(parseMapLink("91.0, 35.0")).toBeNull();
    expect(parseMapLink("31.0, 181.0")).toBeNull();
  });
});

describe("isShortenedMapLink", () => {
  it("flags shortened links, whose coordinates live behind a redirect", () => {
    expect(isShortenedMapLink("https://maps.app.goo.gl/AbCdEf123")).toBe(true);
    expect(isShortenedMapLink("https://goo.gl/maps/xyz")).toBe(true);
  });

  it("does not flag a full link", () => {
    expect(isShortenedMapLink("https://waze.com/ul?ll=31.76,35.21")).toBe(false);
  });
});

describe("pinFrom", () => {
  it("builds a pin from stored numeric columns", () => {
    expect(pinFrom(31.7683, 35.2137)).toEqual({ lat: 31.7683, lng: 35.2137 });
  });

  it("accepts numeric strings, which is how postgres numeric arrives over the wire", () => {
    expect(pinFrom("31.7683", "35.2137")).toEqual({ lat: 31.7683, lng: 35.2137 });
  });

  it("returns null when the customer has no pin saved", () => {
    expect(pinFrom(null, null)).toBeNull();
    expect(pinFrom(undefined, undefined)).toBeNull();
    expect(pinFrom(31.7683, null)).toBeNull();
  });
});

describe("link builders", () => {
  const pin = { lat: 31.7683, lng: 35.2137 };

  it("builds a navigating Waze link", () => {
    expect(wazeLinkForPin(pin)).toBe("https://waze.com/ul?ll=31.7683,35.2137&navigate=yes");
  });

  it("builds a Google Maps link", () => {
    expect(mapsLinkForPin(pin)).toContain("query=31.7683,35.2137");
  });

  it("round-trips: a built link parses back to the same pin", () => {
    expect(parseMapLink(wazeLinkForPin(pin))).toEqual(pin);
    expect(parseMapLink(mapsLinkForPin(pin))).toEqual(pin);
  });

  it("formats a pin for display", () => {
    expect(formatPin(pin)).toBe("31.76830, 35.21370");
  });
});
