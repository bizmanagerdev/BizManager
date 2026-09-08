import { describe, it, expect } from "vitest";
import {
  isHexColor,
  textColorForBackground,
  initialsForName,
  buildColorIndexMap,
  AVATAR_COLORS,
} from "@/components/dashboard/InitialsAvatar";

describe("isHexColor", () => {
  it("accepts a 6-digit hex color, case-insensitively", () => {
    expect(isHexColor("#2563EB")).toBe(true);
    expect(isHexColor("#2563eb")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isHexColor("2563EB")).toBe(false); // missing #
    expect(isHexColor("#2563E")).toBe(false); // 5 digits
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor(null)).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });
});

describe("textColorForBackground", () => {
  it("uses white text on a dark background", () => {
    expect(textColorForBackground("#000000")).toBe("rgb(var(--white))");
  });
  it("uses foreground (dark) text on a light background", () => {
    expect(textColorForBackground("#FFFFFF")).toBe("rgb(var(--foreground))");
  });
  it("every curated AVATAR_COLORS swatch resolves to white text (they're all bold/dark enough)", () => {
    for (const color of AVATAR_COLORS) {
      expect(textColorForBackground(color)).toBe("rgb(var(--white))");
    }
  });
});

describe("initialsForName", () => {
  it("a single name gives just its first letter", () => {
    expect(initialsForName("מאיה")).toBe("מ");
  });
  it("two or more names give first+last initials", () => {
    expect(initialsForName("מאיה כהן")).toBe("מכ");
    expect(initialsForName("יעקב בן דוד הלר")).toBe("יה"); // first + LAST, not middle
  });
  it("? for empty/null/undefined", () => {
    expect(initialsForName(null)).toBe("?");
    expect(initialsForName(undefined)).toBe("?");
    expect(initialsForName("   ")).toBe("?");
  });
});

describe("buildColorIndexMap", () => {
  it("assigns each unique id a distinct index, in sorted order", () => {
    const map = buildColorIndexMap(["user-b", "user-a", "user-c"]);
    expect(map.get("user-a")).toBe(0);
    expect(map.get("user-b")).toBe(1);
    expect(map.get("user-c")).toBe(2);
  });
  it("is deterministic regardless of input order (sorted, not insertion order)", () => {
    const map1 = buildColorIndexMap(["z", "a", "m"]);
    const map2 = buildColorIndexMap(["m", "z", "a"]);
    expect([...map1.entries()]).toEqual([...map2.entries()]);
  });
  it("de-dupes repeated ids and drops null/undefined entries", () => {
    const map = buildColorIndexMap(["user-a", "user-a", null, undefined, "user-b"]);
    expect(map.size).toBe(2);
  });
});
