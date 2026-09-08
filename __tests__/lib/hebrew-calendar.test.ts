import { describe, it, expect } from "vitest";
import { hebrewDayLabel, hebrewFullDate, hebrewParsha, getHolidaysInRange } from "@/lib/hebrew-calendar";

// Dates below are verified against @hebcal/core's own output (not hand-computed) —
// 23 Sept 2025 is 1 Tishrei 5786 (Rosh Hashana day 1).

describe("hebrewDayLabel", () => {
  it("renders the Hebrew day-of-month numeral, niqqud-free", () => {
    expect(hebrewDayLabel(new Date(2025, 8, 23))).toBe("א׳");
  });
});

describe("hebrewFullDate", () => {
  it("renders day + month + year with no niqqud/cantillation marks", () => {
    const text = hebrewFullDate(new Date(2025, 8, 23));
    expect(text).toBe("א׳ תשרי תשפ״ו");
    // The stripped combining-mark range must be gone entirely.
    expect(/[֑-ׇ]/.test(text)).toBe(false);
  });
});

describe("hebrewParsha", () => {
  it("returns that week's parsha for an ordinary week", () => {
    expect(hebrewParsha(new Date(2025, 10, 5))).toBe("פרשת וירא"); // Wed, week of 8 Nov 2025
  });
  it("is the same regardless of which weekday in the week you ask from", () => {
    expect(hebrewParsha(new Date(2025, 10, 8))).toBe(hebrewParsha(new Date(2025, 10, 5))); // the Saturday itself
  });
  it("returns null for a week whose Shabbat falls on a festival's chol ha'moed (no regular weekly reading)", () => {
    expect(hebrewParsha(new Date(2025, 9, 8))).toBeNull(); // week of Sukkot chol ha'moed
  });
});

describe("getHolidaysInRange — curation", () => {
  // One full Hebrew year, 5786.
  const holidays = getHolidaysInRange(new Date(2025, 8, 1), new Date(2026, 8, 1));

  it("marks the festivals (chag) as major", () => {
    expect(holidays.get("2025-09-23")).toEqual({ name: "ראש השנה 5786", major: true }); // Rosh Hashana I
    expect(holidays.get("2025-10-02")).toEqual({ name: "יום כפור", major: true }); // Yom Kippur
    expect(holidays.get("2025-10-14")).toEqual({ name: "שמיני עצרת", major: true }); // Shmini Atzeret
  });

  it("marks EVERY day of a multi-day festival as major, including chol ha'moed (matched by base name, not just the chag flag)", () => {
    expect(holidays.get("2025-10-08")?.major).toBe(true); // Sukkot II, chol ha'moed
    expect(holidays.get("2026-04-05")?.major).toBe(true); // Pesach IV, chol ha'moed
  });

  it("Yom HaAtzma'ut is major even though it isn't flagged CHAG (explicitly curated in)", () => {
    expect(holidays.get("2026-04-22")).toEqual({ name: "יום העצמאות", major: true });
  });

  it("marks a curated minor day (Rosh Chodesh, Chanukah, Purim, the fasts...) as non-major", () => {
    expect(holidays.get("2025-09-25")).toEqual({ name: "צום גדליה", major: false }); // Tzom Gedaliah
    expect(holidays.get("2025-12-14")).toEqual({ name: "חנוכה: א׳ נר", major: false }); // Chanukah night 1
    expect(holidays.get("2026-03-03")).toEqual({ name: "פורים", major: false });
    expect(holidays.get("2026-02-02")).toEqual({ name: "ט״ו בשבט", major: false }); // Tu BiShvat
    expect(holidays.get("2026-04-21")).toEqual({ name: "יום הזכרון", major: false }); // Yom HaZikaron
  });

  it("Rosh Chodesh is matched generically by its name PREFIX, not a fixed list", () => {
    expect(holidays.get("2025-10-22")).toEqual({ name: "ראש חודש חשון", major: false });
  });

  it("drops the uncurated trivia entirely (not just unmarked — absent from the map)", () => {
    // These are the exact examples named in the source code's own comment.
    expect(holidays.has("2025-11-26")).toBe(false); // Ben-Gurion Day
    // 2026-08-14 also carries "Rosh Hashana LaBehemot" (dropped trivia) the same
    // day as Rosh Chodesh Elul (curated in) — the day IS in the map, just for
    // the curated event, not the trivia.
    expect(holidays.get("2026-08-14")).toEqual({ name: "ראש חודש אלול", major: false });
    expect(holidays.has("2026-07-14")).toBe(false); // Jabotinsky Day
    expect(holidays.has("2025-09-27")).toBe(false); // Shabbat Shuva (not a holiday, just a named Shabbat)
  });

  it("an ordinary week with nothing going on has no entries at all", () => {
    const quiet = getHolidaysInRange(new Date(2025, 10, 10), new Date(2025, 10, 14)); // 10-14 Nov 2025
    expect(quiet.size).toBe(0);
  });
});
