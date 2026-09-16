import { describe, it, expect } from "vitest";
import {
  clampFromToBooksStart,
  isMonthBeforeBooksStart,
  normalizeBooksStartDate,
} from "@/lib/settings/booksStartDate";

describe("normalizeBooksStartDate", () => {
  it("accepts a first-of-month date as stored in the DB", () => {
    expect(normalizeBooksStartDate("2026-07-01")).toBe("2026-07-01");
  });
  it("accepts a bare month and pins it to the 1st", () => {
    expect(normalizeBooksStartDate("2026-07")).toBe("2026-07-01");
  });
  it("rejects any day other than the 1st instead of rounding it", () => {
    expect(normalizeBooksStartDate("2026-07-15")).toBeNull();
  });
  it("rejects garbage, bad months and non-strings", () => {
    expect(normalizeBooksStartDate("2026-13-01")).toBeNull();
    expect(normalizeBooksStartDate("July 2026")).toBeNull();
    expect(normalizeBooksStartDate("")).toBeNull();
    expect(normalizeBooksStartDate(null)).toBeNull();
    expect(normalizeBooksStartDate(20260701)).toBeNull();
  });
});

describe("clampFromToBooksStart", () => {
  it("with no start date, the chosen from passes through (empty = no bound)", () => {
    expect(clampFromToBooksStart("2026-03-01", null)).toBe("2026-03-01");
    expect(clampFromToBooksStart("", null)).toBeNull();
  });
  it("'all time' starts at the books start date", () => {
    expect(clampFromToBooksStart("", "2026-07-01")).toBe("2026-07-01");
    expect(clampFromToBooksStart(null, "2026-07-01")).toBe("2026-07-01");
  });
  it("a range reaching before the start is cut at the start", () => {
    expect(clampFromToBooksStart("2026-01-01", "2026-07-01")).toBe("2026-07-01");
  });
  it("a range already after the start is left alone", () => {
    expect(clampFromToBooksStart("2026-08-01", "2026-07-01")).toBe("2026-08-01");
    expect(clampFromToBooksStart("2026-07-01", "2026-07-01")).toBe("2026-07-01");
  });
});

describe("isMonthBeforeBooksStart", () => {
  it("only months strictly before the start month are excluded", () => {
    expect(isMonthBeforeBooksStart("2026-06", "2026-07-01")).toBe(true);
    expect(isMonthBeforeBooksStart("2026-07", "2026-07-01")).toBe(false);
    expect(isMonthBeforeBooksStart("2026-08", "2026-07-01")).toBe(false);
  });
  it("nothing is excluded without a start date", () => {
    expect(isMonthBeforeBooksStart("2020-01", null)).toBe(false);
  });
});
