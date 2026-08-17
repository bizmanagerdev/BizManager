import { describe, it, expect } from "vitest";
import { getNonWorkingHolidaysInRange } from "@/lib/payroll-holidays";

/**
 * The exact days the salaried-hours sheet must NOT print a workday on.
 * These are the cases date-holidays got wrong, which is why this module exists:
 * it knew יום כיפור and פסח א׳ but happily scheduled ערב סוכות and חול המועד.
 */

function nonWorkingDays(year: number, monthIndex: number) {
  return getNonWorkingHolidaysInRange(
    new Date(year, monthIndex, 1),
    new Date(year, monthIndex + 1, 0)
  );
}

describe("getNonWorkingHolidaysInRange", () => {
  it("excludes erev chag as well as the chag itself (Tishrei 5787)", () => {
    const days = nonWorkingDays(2026, 8); // September 2026

    // ערב ראש השנה / ראש השנה (both days)
    expect(days.has("2026-09-11")).toBe(true);
    expect(days.has("2026-09-12")).toBe(true);
    expect(days.has("2026-09-13")).toBe(true);
    // ערב יום כיפור / יום כיפור
    expect(days.has("2026-09-20")).toBe(true);
    expect(days.has("2026-09-21")).toBe(true);
    // ערב סוכות / סוכות א׳
    expect(days.has("2026-09-25")).toBe(true);
    expect(days.has("2026-09-26")).toBe(true);
  });

  it("caps the padded lookahead — a holiday outside the range never leaks in", () => {
    // The lookahead reaches into October to judge Hoshana Rabba, but September's
    // map must still contain only September.
    const september = nonWorkingDays(2026, 8);
    expect([...september.keys()].every((iso) => iso.startsWith("2026-09"))).toBe(true);
  });

  it("works through chol hamoed except its final day", () => {
    const sukkot = nonWorkingDays(2026, 8);
    // סוכות ב׳–ו׳ (חוה״מ) are worked…
    expect(sukkot.has("2026-09-27")).toBe(false);
    expect(sukkot.has("2026-09-28")).toBe(false);
    expect(sukkot.has("2026-09-29")).toBe(false);
    expect(sukkot.has("2026-09-30")).toBe(false);
    expect(sukkot.has("2026-10-01")).toBe(false);

    const pesach = nonWorkingDays(2026, 3); // April 2026
    expect(pesach.has("2026-04-01")).toBe(true); // ערב פסח
    expect(pesach.has("2026-04-02")).toBe(true); // פסח א׳
    expect(pesach.has("2026-04-03")).toBe(false); // פסח ב׳ (חוה״מ) — worked
    expect(pesach.has("2026-04-06")).toBe(false); // פסח ה׳ (חוה״מ) — worked
    expect(pesach.has("2026-04-07")).toBe(true); // פסח ו׳ — erev שביעי של פסח
    expect(pesach.has("2026-04-08")).toBe(true); // פסח ז׳
  });

  it("still closes the last chol hamoed day when it falls in the next month", () => {
    // הושענא רבה 2026 is 2 October — the chol hamoed run starts in September, so
    // the two ends of it land in different months, and שמיני עצרת (3 October) is
    // what makes the 2nd a day off.
    const october = nonWorkingDays(2026, 9);
    expect(october.has("2026-10-01")).toBe(false); // סוכות ו׳ (חוה״מ) — worked
    expect(october.has("2026-10-02")).toBe(true); // הושענא רבה — ערב שמיני עצרת
    expect(october.has("2026-10-03")).toBe(true); // שמיני עצרת
  });

  it("excludes erev shavuot and shavuot", () => {
    const days = nonWorkingDays(2026, 4); // May 2026
    expect(days.has("2026-05-21")).toBe(true); // ערב שבועות
    expect(days.has("2026-05-22")).toBe(true); // שבועות
  });

  it("excludes Yom HaAtzma'ut but keeps Yom HaZikaron a working day", () => {
    const days = nonWorkingDays(2026, 3); // April 2026
    expect(days.has("2026-04-22")).toBe(true); // יום העצמאות
    expect(days.has("2026-04-21")).toBe(false); // יום הזיכרון — a work day
  });

  it("keeps EREV of a non-chag a working day", () => {
    // hebcal stamps EREV on ערב פורים, ערב תשעה באב and the first night of
    // Chanukah too — none of which are days off here.
    expect(nonWorkingDays(2026, 2).has("2026-03-02")).toBe(false); // ערב פורים
    expect(nonWorkingDays(2026, 6).has("2026-07-22")).toBe(false); // ערב תשעה באב
    expect(nonWorkingDays(2026, 11).has("2026-12-04")).toBe(false); // חנוכה נר א׳
  });

  it("leaves ordinary days and minor holidays alone", () => {
    const days = nonWorkingDays(2026, 4); // May 2026
    expect(days.has("2026-05-12")).toBe(false); // a plain Tuesday
    expect(days.has("2026-05-05")).toBe(false); // ל״ג בעומר
  });
});
