import { describe, it, expect } from "vitest";
import { durationSegments, timeSegments, voice, RECORDINGS } from "@/lib/attendance/phone-voice";

describe("timeSegments", () => {
  it("reads a round hour as just the hour", () => {
    expect(timeSegments(8, 0)).toEqual([{ number: 8 }]);
  });

  it("joins hour and minute with the 'ו' connector", () => {
    expect(timeSegments(8, 14)).toEqual([{ number: 8 }, { recording: RECORDINGS.andWord }, { number: 14 }]);
  });
});

describe("durationSegments — plural clips only", () => {
  it("reads one hour with the plural clip (no singular recorded)", () => {
    expect(durationSegments(60)).toEqual([{ number: 1 }, { recording: RECORDINGS.hoursWord }]);
  });

  it("reads two hours", () => {
    expect(durationSegments(120)).toEqual([{ number: 2 }, { recording: RECORDINGS.hoursWord }]);
  });

  it("reads plural hours and minutes with a connector (6h 20m)", () => {
    expect(durationSegments(380)).toEqual([
      { number: 6 },
      { recording: RECORDINGS.hoursWord },
      { recording: RECORDINGS.andWord },
      { number: 20 },
      { recording: RECORDINGS.minutesWord },
    ]);
  });

  it("reads minutes only when under an hour", () => {
    expect(durationSegments(20)).toEqual([{ number: 20 }, { recording: RECORDINGS.minutesWord }]);
  });

  it("says '0 minutes' for a sub-minute shift", () => {
    expect(durationSegments(0)).toEqual([{ number: 0 }, { recording: RECORDINGS.minutesWord }]);
  });
});

describe("voice.clockOutSuccess", () => {
  it("speaks exit time then shift duration in order", () => {
    const result = voice.clockOutSuccess(17, 5, 380);
    expect(result.ok).toBe(true);
    expect(result.hangup).toBe(true);
    expect(result.action).toBe("clock_out");
    expect(result.play).toEqual([
      { recording: RECORDINGS.clockOutSuccess },
      { number: 17 },
      { recording: RECORDINGS.andWord },
      { number: 5 },
      { recording: RECORDINGS.shiftDuration },
      { number: 6 },
      { recording: RECORDINGS.hoursWord },
      { recording: RECORDINGS.andWord },
      { number: 20 },
      { recording: RECORDINGS.minutesWord },
    ]);
  });
});

describe("voice.alreadyOpen", () => {
  it("plays the merged clip then the clock-in time (no separate only_exit)", () => {
    const result = voice.alreadyOpen(8, 14);
    expect(result.play).toEqual([
      { recording: RECORDINGS.alreadyOpen },
      { number: 8 },
      { recording: RECORDINGS.andWord },
      { number: 14 },
    ]);
  });
});

describe("voice.pastShiftSaved", () => {
  it("confirms the saved shift and reads its duration", () => {
    const result = voice.pastShiftSaved(510);
    expect(result.ok).toBe(true);
    expect(result.play).toEqual([
      { recording: RECORDINGS.pastShiftSaved },
      { recording: RECORDINGS.shiftDuration },
      { number: 8 },
      { recording: RECORDINGS.hoursWord },
      { recording: RECORDINGS.andWord },
      { number: 30 },
      { recording: RECORDINGS.minutesWord },
    ]);
  });
});

describe("voice error cases", () => {
  it("marks unrecognized callers as not ok", () => {
    const result = voice.notRecognized();
    expect(result.ok).toBe(false);
    expect(result.play).toEqual([{ recording: RECORDINGS.notRecognized }]);
  });

  it("marks invalid date/time entry as not ok", () => {
    const result = voice.invalidDatetime();
    expect(result.ok).toBe(false);
    expect(result.play).toEqual([{ recording: RECORDINGS.invalidDatetime }]);
  });
});
