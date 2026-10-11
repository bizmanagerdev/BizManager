import { describe, expect, it } from "vitest";
import { CITY_COLOURS, cityColour } from "@/lib/deliveries/city-colours";

const parse = (colour: string) => {
  const [, l, c, h] = colour.match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/)!.map(Number);
  return { l, c, h };
};

const SIX = ["ירושלים", "בני ברק", "בית שמש", "מודיעין עילית", "אשדוד", "ביתר עילית"];
const OTHERS = ["אלעד", "נתניה", "ערד", "תל אביב", "גבעת זאב", "קרית גת", "בת ים", "רחובות", "פתח תקווה", "רעננה"];

// A city's colour is fixed (owner, 2026-10-11: "Jerusalem should always be a
// certain color") — never by its place on the list.
describe("cityColour", () => {
  it("gives every city deliveries have gone to a colour of its own", () => {
    const all = [...SIX, ...OTHERS];
    expect(new Set(all.map(cityColour)).size).toBe(all.length);
  });

  it("never gives another city one of the six busiest cities' colours", () => {
    const six = new Set(SIX.map(cityColour));
    for (const city of [...OTHERS, "חיפה", "צפת", "כרמיאל", "אופקים", "", "עיר שלא קיימת"]) {
      expect(six.has(cityColour(city))).toBe(false);
    }
  });

  it("reads the same city however it was typed, and the same every time", () => {
    expect(cityColour("בני-ברק")).toBe(cityColour("בני ברק"));
    expect(cityColour("  ירושלים ")).toBe(cityColour("ירושלים"));
    expect(cityColour("חיפה")).toBe(cityColour("חיפה"));
  });

  // Owner, 2026-10-11: light and sweet; no purple, no orange (a peach is fine), no browns.
  it("is light, with no purple, orange or brown", () => {
    for (const colour of CITY_COLOURS) {
      const { l, c, h } = parse(colour);
      expect(l).toBeGreaterThanOrEqual(0.72);
      expect(h >= 280 && h <= 340).toBe(false); // purple
      // orange / brown: warm hues dark or strong; a light, soft peach is allowed
      expect(h >= 30 && h <= 85 && (l < 0.8 || c > 0.11)).toBe(false);
    }
  });
});
