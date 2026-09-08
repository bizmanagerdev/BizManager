import { describe, it, expect } from "vitest";
import { stepMonthly, buildRentSchedule } from "@/lib/rentSchedule";

describe("stepMonthly", () => {
  it("adds whole months, keeping the same day", () => {
    expect(stepMonthly("2026-01-15", 1)).toBe("2026-02-15");
    expect(stepMonthly("2026-01-15", 3)).toBe("2026-04-15");
  });
  it("rolls over the year boundary", () => {
    expect(stepMonthly("2026-11-01", 2)).toBe("2027-01-01");
  });
  it("clamps to the last day of a shorter target month (Jan 31 + 1 -> Feb 28)", () => {
    expect(stepMonthly("2026-01-31", 1)).toBe("2026-02-28");
  });
  it("clamps into a leap-year February correctly", () => {
    expect(stepMonthly("2027-01-31", 13)).toBe("2028-02-29"); // 2028 is a leap year
  });
  it("returns the input unchanged when it isn't a parseable date", () => {
    expect(stepMonthly("not-a-date", 1)).toBe("not-a-date");
  });
});

describe("buildRentSchedule", () => {
  it("builds one row per month, dueDate defaulting to paymentDate", () => {
    const rows = buildRentSchedule({ firstMonth: "2026-01-05", count: 3, monthlyAmount: 3500 });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.paymentDate)).toEqual(["2026-01-05", "2026-02-05", "2026-03-05"]);
    for (const r of rows) {
      expect(r.dueDate).toBe(r.paymentDate);
      expect(r.amount).toBe(3500);
    }
  });

  it("increments a numeric starting check number, preserving zero-padding while it fits", () => {
    const rows = buildRentSchedule({
      firstMonth: "2026-01-01",
      count: 3,
      monthlyAmount: 1000,
      startingCheckNumber: "000123",
    });
    expect(rows.map((r) => r.checkNumber)).toEqual(["000123", "000124", "000125"]);
  });

  it("drops the padding once the incremented number outgrows the original width", () => {
    const rows = buildRentSchedule({
      firstMonth: "2026-01-01",
      count: 2,
      monthlyAmount: 1000,
      startingCheckNumber: "998",
    });
    expect(rows.map((r) => r.checkNumber)).toEqual(["998", "999"]);
    // one more, past 999 -> no longer fits width 3
    const rows2 = buildRentSchedule({
      firstMonth: "2026-01-01",
      count: 3,
      monthlyAmount: 1000,
      startingCheckNumber: "998",
    });
    expect(rows2[2].checkNumber).toBe("1000");
  });

  it("leaves checkNumber blank on every row when no starting number is given", () => {
    const rows = buildRentSchedule({ firstMonth: "2026-01-01", count: 2, monthlyAmount: 1000 });
    expect(rows.every((r) => r.checkNumber === "")).toBe(true);
  });

  it("leaves checkNumber blank when the starting value isn't numeric", () => {
    const rows = buildRentSchedule({
      firstMonth: "2026-01-01",
      count: 2,
      monthlyAmount: 1000,
      startingCheckNumber: "ABC",
    });
    expect(rows.every((r) => r.checkNumber === "")).toBe(true);
  });

  it("returns [] for a non-positive count, missing month, or non-positive amount", () => {
    expect(buildRentSchedule({ firstMonth: "2026-01-01", count: 0, monthlyAmount: 1000 })).toEqual([]);
    expect(buildRentSchedule({ firstMonth: "2026-01-01", count: -2, monthlyAmount: 1000 })).toEqual([]);
    expect(buildRentSchedule({ firstMonth: "", count: 3, monthlyAmount: 1000 })).toEqual([]);
    expect(buildRentSchedule({ firstMonth: "2026-01-01", count: 3, monthlyAmount: 0 })).toEqual([]);
  });

  it("rounds a fractional count", () => {
    const rows = buildRentSchedule({ firstMonth: "2026-01-01", count: 2.4, monthlyAmount: 1000 });
    expect(rows).toHaveLength(2);
  });
});
