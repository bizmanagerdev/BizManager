import { describe, it, expect } from "vitest";
import { greetingForHour, formatToday, greetingTitle, firstNameOf } from "@/lib/dashboard/greeting";

describe("greetingForHour", () => {
  it("Hebrew: morning starts at 04:00, not midnight — late night is still ערב טוב", () => {
    expect(greetingForHour(2)).toBe("ערב טוב");
    expect(greetingForHour(3)).toBe("ערב טוב");
    expect(greetingForHour(4)).toBe("בוקר טוב");
  });
  it("Hebrew: the rest of the day's boundaries", () => {
    expect(greetingForHour(11)).toBe("בוקר טוב");
    expect(greetingForHour(12)).toBe("צהריים טובים");
    expect(greetingForHour(17)).toBe("צהריים טובים");
    expect(greetingForHour(18)).toBe("ערב טוב");
    expect(greetingForHour(23)).toBe("ערב טוב");
  });
  it("Arabic locale uses its own wording on the same hour boundaries", () => {
    expect(greetingForHour(2, "ar")).toBe("مساء الخير");
    expect(greetingForHour(9, "ar")).toBe("صباح الخير");
    expect(greetingForHour(15, "ar")).toBe("طاب يومك");
    expect(greetingForHour(20, "ar")).toBe("مساء الخير");
  });
});

describe("greetingTitle", () => {
  it("appends the name and a waving-hand emoji", () => {
    expect(greetingTitle("בוקר טוב", "יעקב")).toBe("בוקר טוב, יעקב 👋");
  });
  it("omits the comma+name entirely when there's no name", () => {
    expect(greetingTitle("בוקר טוב", "")).toBe("בוקר טוב 👋");
  });
});

describe("firstNameOf", () => {
  it("takes the first word of a full name", () => {
    expect(firstNameOf("יעקב הלר")).toBe("יעקב");
  });
  it("blanks out for null/undefined/empty", () => {
    expect(firstNameOf(null)).toBe("");
    expect(firstNameOf(undefined)).toBe("");
    expect(firstNameOf("   ")).toBe("");
  });
});

describe("formatToday", () => {
  it("renders the full weekday + day + month + year", () => {
    const text = formatToday(new Date("2026-08-18T10:00:00Z"));
    expect(text).toContain("2026");
    expect(text).toContain("אוגוסט");
  });
});
