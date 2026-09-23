import { describe, it, expect } from "vitest";
import { daysBetweenKeys, meetingPeriod, shiftDateKey } from "@/lib/meetings/stats";

// The period a weekly meeting reviews runs from the day AFTER the previous
// meeting through the meeting's own date. It is "weekly" by intention, not by
// arithmetic — a holiday or a shutdown makes it longer, and the numbers have to
// cover the whole gap rather than lose the middle of it.

describe("daysBetweenKeys", () => {
  it("counts both ends (a single day is one day)", () => {
    expect(daysBetweenKeys("2026-09-23", "2026-09-23")).toBe(1);
  });

  it("counts a plain week as 7", () => {
    expect(daysBetweenKeys("2026-09-17", "2026-09-23")).toBe(7);
  });

  it("crosses a month boundary", () => {
    expect(daysBetweenKeys("2026-08-30", "2026-09-02")).toBe(4);
  });

  it("crosses a year boundary", () => {
    expect(daysBetweenKeys("2026-12-30", "2027-01-02")).toBe(4);
  });

  it("handles a leap day", () => {
    expect(daysBetweenKeys("2028-02-28", "2028-03-01")).toBe(3);
  });
});

describe("shiftDateKey", () => {
  it("rolls over a month end", () => {
    expect(shiftDateKey("2026-09-30", 1)).toBe("2026-10-01");
  });

  it("rolls back over a month start", () => {
    expect(shiftDateKey("2026-10-01", -1)).toBe("2026-09-30");
  });
});

describe("meetingPeriod", () => {
  it("covers exactly the week when meetings are 7 days apart", () => {
    const period = meetingPeriod("2026-09-16", "2026-09-23");
    expect(period.fromKey).toBe("2026-09-17");
    expect(period.toKey).toBe("2026-09-23");
    expect(period.days).toBe(7);
  });

  it("starts the morning AFTER the previous meeting, so no day is counted twice", () => {
    // The 16th belonged to the previous meeting's period; this one starts on the 17th.
    expect(meetingPeriod("2026-09-16", "2026-09-23").fromKey).toBe("2026-09-17");
  });

  it("covers the whole gap after a three-week holiday break", () => {
    const period = meetingPeriod("2026-09-02", "2026-09-23");
    expect(period.fromKey).toBe("2026-09-03");
    expect(period.toKey).toBe("2026-09-23");
    expect(period.days).toBe(21);
  });

  it("leaves no day between two consecutive periods", () => {
    const first = meetingPeriod("2026-09-02", "2026-09-09");
    const second = meetingPeriod("2026-09-09", "2026-09-30");
    // The second picks up the day right after the first ends — nothing falls
    // down the gap, however long the gap is.
    expect(second.fromKey).toBe(shiftDateKey(first.toKey, 1));
  });

  it("falls back to 7 days for the very first meeting", () => {
    const period = meetingPeriod(null, "2026-09-23");
    expect(period.fromKey).toBe("2026-09-17");
    expect(period.days).toBe(7);
  });

  it("falls back to 7 days when the previous meeting is not actually earlier", () => {
    // Defensive: a meeting opened out of order must not produce a negative or
    // zero-length period.
    expect(meetingPeriod("2026-09-30", "2026-09-23").days).toBe(7);
    expect(meetingPeriod("2026-09-23", "2026-09-23").days).toBe(7);
  });

  it("handles back-to-back meetings on consecutive days as a one-day period", () => {
    const period = meetingPeriod("2026-09-22", "2026-09-23");
    expect(period.days).toBe(1);
    expect(period.fromKey).toBe("2026-09-23");
  });

  it("spans a year boundary", () => {
    const period = meetingPeriod("2026-12-24", "2027-01-07");
    expect(period.fromKey).toBe("2026-12-25");
    expect(period.days).toBe(14);
  });

  it("ends at midnight after the meeting day, so the meeting day counts in full", () => {
    const period = meetingPeriod("2026-09-16", "2026-09-23");
    // Israel is UTC+3 in September, so local midnight on the 24th is 21:00 UTC
    // on the 23rd — anything recorded during the meeting day is inside.
    expect(period.untilIso).toBe("2026-09-23T21:00:00.000Z");
    expect(period.fromIso).toBe("2026-09-16T21:00:00.000Z");
  });
});
