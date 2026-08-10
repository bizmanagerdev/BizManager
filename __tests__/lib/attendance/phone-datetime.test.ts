import { describe, it, expect } from "vitest";
import {
  parseDateField,
  parseTimeField,
  israelWallClockToUtc,
  buildPastShift,
  buildPastInstant,
} from "@/lib/attendance/phone-datetime";

describe("parseDateField / parseTimeField", () => {
  it("parses DDMM", () => {
    expect(parseDateField("0407")).toEqual({ day: 4, month: 7 });
    expect(parseDateField("407")).toEqual({ day: 4, month: 7 }); // dropped leading zero
    expect(parseDateField("3112")).toEqual({ day: 31, month: 12 });
  });

  it("rejects impossible dates", () => {
    expect(parseDateField("9999")).toBeNull(); // month 99
    expect(parseDateField("00")).toBeNull();
    expect(parseDateField("12")).toBeNull(); // too short
  });

  it("parses HHMM and rejects impossible times", () => {
    expect(parseTimeField("0830")).toEqual({ hour: 8, minute: 30 });
    expect(parseTimeField("2560")).toBeNull(); // hour 25
    expect(parseTimeField("1290")).toBeNull(); // minute 90
  });
});

describe("israelWallClockToUtc — DST aware", () => {
  it("summer (IDT, UTC+3): 08:30 → 05:30Z", () => {
    expect(israelWallClockToUtc(2026, 7, 4, 8, 30).toISOString()).toBe("2026-07-04T05:30:00.000Z");
  });

  it("winter (IST, UTC+2): 08:30 → 06:30Z", () => {
    expect(israelWallClockToUtc(2026, 1, 4, 8, 30).toISOString()).toBe("2026-01-04T06:30:00.000Z");
  });
});

describe("buildPastShift", () => {
  const now = new Date("2026-07-10T12:00:00Z");

  it("accepts a normal same-day shift (summer)", () => {
    const result = buildPastShift({ startDate: "0407", startTime: "0830", endDate: "0407", endTime: "1700" }, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.clockIn.toISOString()).toBe("2026-07-04T05:30:00.000Z");
      expect(result.clockOut.toISOString()).toBe("2026-07-04T14:00:00.000Z");
      expect(result.workedMinutes).toBe(510);
    }
  });

  it("accepts an overnight shift crossing midnight", () => {
    const result = buildPastShift({ startDate: "0307", startTime: "2200", endDate: "0407", endTime: "0600" }, now);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.workedMinutes).toBe(480);
  });

  it("rejects a shift ending in the future", () => {
    const earlyNow = new Date("2026-07-04T04:00:00Z"); // 07:00 IDT, before the 17:00 end
    const result = buildPastShift({ startDate: "0407", startTime: "0830", endDate: "0407", endTime: "1700" }, earlyNow);
    expect(result).toEqual({ ok: false, reason: "future" });
  });

  it("rejects a shift too far in the past", () => {
    const result = buildPastShift({ startDate: "0101", startTime: "0800", endDate: "0101", endTime: "1700" }, now);
    expect(result).toEqual({ ok: false, reason: "range" });
  });

  it("rejects unparseable input", () => {
    const result = buildPastShift({ startDate: "9999", startTime: "0800", endDate: "0407", endTime: "1700" }, now);
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an end-before-start typo", () => {
    const result = buildPastShift({ startDate: "0407", startTime: "0800", endDate: "0407", endTime: "0700" }, now);
    expect(result.ok).toBe(false);
  });
});

describe("buildPastInstant — a single late entry / exit time", () => {
  const now = new Date("2026-07-04T14:00:00Z"); // 17:00 IDT

  it("parses a past instant (08:30 IDT → 05:30Z)", () => {
    const result = buildPastInstant("0407", "0830", now);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.at.toISOString()).toBe("2026-07-04T05:30:00.000Z");
  });

  it("rejects a time in the future", () => {
    const result = buildPastInstant("0407", "2000", now); // 20:00 IDT, later today
    expect(result).toEqual({ ok: false, reason: "future" });
  });

  it("rejects a time too far in the past", () => {
    const result = buildPastInstant("0101", "0800", now);
    expect(result).toEqual({ ok: false, reason: "range" });
  });

  it("rejects unparseable input", () => {
    expect(buildPastInstant("9999", "0800", now)).toEqual({ ok: false, reason: "invalid" });
    expect(buildPastInstant("0407", "2570", now)).toEqual({ ok: false, reason: "invalid" });
  });
});
