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

describe("durationSegments — always the fixed hours+minutes shape", () => {
  const shape = (hours: number, minutes: number) => [
    { number: hours },
    { recording: RECORDINGS.hoursWord },
    { recording: RECORDINGS.andWord },
    { number: minutes },
    { recording: RECORDINGS.minutesWord },
  ];

  it("reads one whole hour as '1 שעות ו-0 דקות'", () => {
    expect(durationSegments(60)).toEqual(shape(1, 0));
  });

  it("reads two whole hours", () => {
    expect(durationSegments(120)).toEqual(shape(2, 0));
  });

  it("reads hours and minutes (6h 20m)", () => {
    expect(durationSegments(380)).toEqual(shape(6, 20));
  });

  it("keeps the hours slot (0) for a sub-hour shift", () => {
    expect(durationSegments(20)).toEqual(shape(0, 20));
  });

  it("reads '0 שעות ו-0 דקות' for a sub-minute shift", () => {
    expect(durationSegments(0)).toEqual(shape(0, 0));
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
