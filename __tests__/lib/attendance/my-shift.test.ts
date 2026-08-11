import { describe, it, expect } from "vitest";
import {
  MAX_BACKDATE_DAYS,
  attendanceSourceLabel,
  parseSelfReportedTime,
} from "@/lib/attendance/my-shift";

// One rule decides what a worker may claim as a work time, shared by
// /api/attendance/my/{start,close,log}. It's the only thing standing between
// "I forgot to clock in" and "I worked 300 hours last March", so the boundaries
// are pinned here rather than re-checked per route.

const NOW = new Date("2026-08-11T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function expectError(result: ReturnType<typeof parseSelfReportedTime>) {
  if (!("error" in result)) throw new Error("expected a rejection, got a date");
  return result.error;
}

describe("parseSelfReportedTime", () => {
  it("accepts a time earlier today", () => {
    const result = parseSelfReportedTime(iso(-4 * HOUR), "שעת התחלה", NOW);
    expect("date" in result && result.date.toISOString()).toBe(iso(-4 * HOUR));
  });

  it("accepts the edge of the backdating window", () => {
    const result = parseSelfReportedTime(iso(-MAX_BACKDATE_DAYS * DAY + MINUTE), "שעת התחלה", NOW);
    expect("date" in result).toBe(true);
  });

  it("rejects anything older than the window, and says to ask the boss", () => {
    const message = expectError(parseSelfReportedTime(iso(-MAX_BACKDATE_DAYS * DAY - MINUTE), "שעת התחלה", NOW));
    expect(message).toContain("פנה למנהל");
  });

  it("rejects a future time", () => {
    expect(expectError(parseSelfReportedTime(iso(HOUR), "שעת סיום", NOW))).toContain("בעתיד");
  });

  it("tolerates a few minutes of phone clock skew", () => {
    // A phone running 2 minutes fast must not make a legitimate "now" unusable.
    expect("date" in parseSelfReportedTime(iso(2 * MINUTE), "שעת סיום", NOW)).toBe(true);
  });

  it("rejects a missing or unparseable value, naming the field", () => {
    expect(expectError(parseSelfReportedTime("", "שעת התחלה", NOW))).toContain("שעת התחלה");
    expect(expectError(parseSelfReportedTime(null, "שעת התחלה", NOW))).toContain("שעת התחלה");
    expect(expectError(parseSelfReportedTime("לא תאריך", "שעת סיום", NOW))).toContain("שעת סיום");
  });
});

describe("attendanceSourceLabel", () => {
  it("names each origin the payroll queue can show", () => {
    expect(attendanceSourceLabel("app")).toBe("דיווח מהאפליקציה");
    expect(attendanceSourceLabel("phone_manual")).toBe("נוסף ידנית");
    expect(attendanceSourceLabel("phone")).toBe("דיווח טלפוני");
    // Unknown/missing falls back to the phone wording rather than rendering blank.
    expect(attendanceSourceLabel(null)).toBe("דיווח טלפוני");
  });
});
