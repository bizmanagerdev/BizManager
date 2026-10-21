import { describe, expect, it } from "vitest";
import {
  addRentPeriods,
  firstRentPeriod,
  nextRentPeriod,
  rentDueLabel,
  rentPeriodLabel,
  rentPeriodOf,
  rentPeriodStarts,
  type RentPeriodLease,
} from "@/lib/rent-periods";

// Rent periods (owner, 2026-10-20): a lease paid on א׳ of each Hebrew month is
// due on that day whatever the regular date — 13 times in a leap year — and a
// regular lease on its day of the month; either can be yearly.

const HEBREW: RentPeriodLease = { startDate: "2026-07-15", rentCalendar: "hebrew", rentHebrewDay: 1 };
const REGULAR: RentPeriodLease = { startDate: "2026-06-01", rentCalendar: "gregorian", rentDayOfMonth: 1 };

describe("a lease on the Hebrew calendar", () => {
  it("is due on א׳ of every Hebrew month — Rosh Chodesh, not the 1st", () => {
    expect(rentPeriodStarts(HEBREW, "2026-10-01", "2026-12-31")).toEqual(["2026-10-12", "2026-11-11", "2026-12-11"]);
  });

  it("a leap year has 13 periods: אדר א׳ and אדר ב׳ each", () => {
    // Tishrei 5787 (12 Sep 2026) to Tishrei 5788.
    const year = rentPeriodStarts(HEBREW, "2026-09-12", "2027-10-01");
    expect(year).toHaveLength(13);
    expect(year).toContain("2027-02-08"); // א׳ אדר א׳
    expect(year).toContain("2027-03-10"); // א׳ אדר ב׳
  });

  it("names its months in Hebrew", () => {
    expect(rentPeriodLabel(HEBREW, "2026-10-12")).toBe("חשון תשפ״ז");
    expect(rentPeriodLabel(HEBREW, "2027-02-08")).toBe("אדר א׳ תשפ״ז");
    expect(rentPeriodLabel(HEBREW, "2026-10-12", 2)).toBe("חשון – כסלו תשפ״ז");
    expect(rentDueLabel(HEBREW)).toBe("בכל א׳ לחודש העברי");
  });

  it("a day in the middle of a month belongs to that month's period", () => {
    expect(rentPeriodOf(HEBREW, "2026-10-20")).toBe("2026-10-12");
    expect(nextRentPeriod(HEBREW, "2026-10-20")).toBe("2026-11-11");
    expect(addRentPeriods(HEBREW, "2026-10-12", 2)).toBe("2026-12-11");
  });

  it("ל׳ in a 29-day month: its last day", () => {
    const thirtieth = { ...HEBREW, rentHebrewDay: 30 };
    // אייר always has 29 days: its period is כ״ט אייר (5 Jun 2027).
    expect(rentPeriodStarts(thirtieth, "2027-05-20", "2027-06-10")).toEqual(["2027-06-05"]);
  });
});

describe("a regular lease", () => {
  it("is due on its day of every month", () => {
    expect(rentPeriodStarts(REGULAR, "2026-10-01", "2026-12-31")).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
    expect(rentPeriodLabel(REGULAR, "2026-11-01")).toBe("נובמבר 2026");
    expect(rentPeriodLabel(REGULAR, "2026-06-01", 2)).toBe("יוני – יולי 2026");
    expect(rentDueLabel(REGULAR)).toBe("בכל 1 לחודש");
  });

  it("the 31st in a short month: its last day", () => {
    expect(rentPeriodStarts({ ...REGULAR, rentDayOfMonth: 31 }, "2026-11-01", "2026-11-30")).toEqual(["2026-11-30"]);
  });

  it("no day set: the day it started", () => {
    expect(firstRentPeriod({ startDate: "2026-07-15" })).toBe("2026-07-15");
  });

  it("yearly: once a year, on the day it started", () => {
    const storage: RentPeriodLease = { startDate: "2026-03-01", periodMonths: 12 };
    expect(rentPeriodStarts(storage, "2026-01-01", "2028-12-31")).toEqual(["2026-03-01", "2027-03-01", "2028-03-01"]);
    expect(nextRentPeriod(storage, "2026-10-20")).toBe("2027-03-01");
  });
});
