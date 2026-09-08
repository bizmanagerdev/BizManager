import { describe, it, expect } from "vitest";
import { endsNextDay, shiftHoursText } from "@/components/attendance/DayTile";

describe("endsNextDay", () => {
  it("false for a shift with no clock-out yet (still open)", () => {
    expect(endsNextDay("2026-06-15T22:00:00Z", null)).toBe(false);
  });
  it("false when clock-in and clock-out fall on the same calendar day", () => {
    // Both comfortably mid-day UTC, so this holds regardless of the runner's
    // local timezone offset.
    expect(endsNextDay("2026-06-15T09:00:00Z", "2026-06-15T11:00:00Z")).toBe(false);
  });
  it("true when the shift crossed midnight into the next day", () => {
    // Exactly 24h apart: whatever the local offset, both shift by the same
    // amount, so they always land on different calendar days.
    expect(endsNextDay("2026-06-15T10:00:00Z", "2026-06-16T10:00:00Z")).toBe(true);
  });
});

describe("shiftHoursText", () => {
  it("renders 'start עד end' in HH:MM (Israel time)", () => {
    const text = shiftHoursText("2026-06-15T08:00:00Z", "2026-06-15T14:00:00Z");
    expect(text).toContain(" עד ");
    expect(text).toMatch(/^\d{2}:\d{2} עד \d{2}:\d{2}$/);
  });
  it("an open shift (no clock-out) reads 'עד עכשיו', never an ellipsis", () => {
    const text = shiftHoursText("2026-06-15T08:00:00Z", null);
    expect(text).toMatch(/^\d{2}:\d{2} עד עכשיו$/);
    expect(text).not.toContain("…");
  });
});
