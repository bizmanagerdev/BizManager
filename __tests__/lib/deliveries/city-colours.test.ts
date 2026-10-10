import { describe, expect, it } from "vitest";
import { cityColour } from "@/lib/deliveries/city-colours";

// A city's colour is fixed (owner, 2026-10-11: "Jerusalem should always be a
// certain color") — never by its place on the list.
describe("cityColour", () => {
  it("gives the main cities their own fixed colours", () => {
    expect(cityColour("ירושלים")).toBe("oklch(0.72 0.15 52)");
    expect(cityColour("בני ברק")).toBe("oklch(0.62 0.15 305)");
    expect(cityColour("ירושלים")).not.toBe(cityColour("בני ברק"));
  });

  it("reads the same city however it was typed", () => {
    expect(cityColour("בני-ברק")).toBe(cityColour("בני ברק"));
    expect(cityColour("  ירושלים ")).toBe(cityColour("ירושלים"));
  });

  it("gives any other city the same colour every time", () => {
    expect(cityColour("רעננה")).toBe(cityColour("רעננה"));
    expect(cityColour("רעננה")).toMatch(/^oklch\(/);
    expect(cityColour(null)).toMatch(/^oklch\(/);
  });
});
