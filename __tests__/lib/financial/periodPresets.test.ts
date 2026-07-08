import { describe, it, expect } from "vitest";
import { monthRange, presetRange, matchesPreset, recentMonthKeys } from "@/lib/financial/periodPresets";

describe("monthRange", () => {
  it("returns first→last day of the month", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" }); // leap year
    expect(monthRange("2026-07")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });
  it("rejects a bad key", () => {
    expect(monthRange("2026-13")).toBeNull();
  });
});

describe("presetRange", () => {
  const today = "2026-07-06";
  it("this_month", () => {
    expect(presetRange("this_month", today)).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });
  it("last_month crosses year boundary", () => {
    expect(presetRange("last_month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
  it("this_year", () => {
    expect(presetRange("this_year", today)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("matchesPreset", () => {
  it("is true only for the exact range", () => {
    expect(matchesPreset("this_month", "2026-07-01", "2026-07-31", "2026-07-06")).toBe(true);
    expect(matchesPreset("this_month", "2026-07-01", "2026-07-15", "2026-07-06")).toBe(false);
  });
});

describe("recentMonthKeys", () => {
  it("lists newest first and walks back across the year boundary", () => {
    expect(recentMonthKeys("2026-02-06", 4)).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
  });
});
