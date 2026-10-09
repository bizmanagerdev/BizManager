import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import {
  israelDateKey,
  israelLocalValueToDate,
  israelLocalValueToIso,
  israelOffsetMinutes,
  israelWallClockToUtc,
  isDeviceClockOnIsraelTime,
  nowIsraelLocalValue,
  toIsraelLocalValue,
} from "@/lib/timezone";

/**
 * The bug these lock down: a worker OUT OF THE COUNTRY typed 08:30 into his shift
 * and it was stored as 08:30 on HIS phone's clock — 15:30 in Israel, seven hours
 * of work that never happened. Every assertion here is therefore also run with
 * the process clock moved abroad, and must come out identical to the Israeli one.
 */
const ORIGINAL_TZ = process.env.TZ;

/** Run a block as if the device were somewhere else entirely. */
function onDeviceIn<T>(timeZone: string, run: () => T): T {
  process.env.TZ = timeZone;
  try {
    return run();
  } finally {
    process.env.TZ = ORIGINAL_TZ;
  }
}

const AWAY = ["America/New_York", "America/Los_Angeles", "Asia/Tokyo", "UTC", "Europe/Berlin"];

beforeAll(() => {
  // Guard the guards: if this runtime ignored a TZ change, every "abroad"
  // assertion below would pass for the wrong reason.
  const abroad = onDeviceIn("America/New_York", () => new Date("2026-09-22T08:30").toISOString());
  expect(abroad).toBe("2026-09-22T12:30:00.000Z");
});

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe("israelLocalValueToIso — what the worker typed means Israel time", () => {
  it("summer (IDT, +3): 08:30 keyed in is 05:30Z", () => {
    expect(israelLocalValueToIso("2026-09-22T08:30")).toBe("2026-09-22T05:30:00.000Z");
  });

  it("winter (IST, +2): the same 08:30 is 06:30Z", () => {
    expect(israelLocalValueToIso("2026-01-22T08:30")).toBe("2026-01-22T06:30:00.000Z");
  });

  it("gives the SAME instant whatever country the device is in", () => {
    for (const timeZone of AWAY) {
      expect(onDeviceIn(timeZone, () => israelLocalValueToIso("2026-09-22T08:30"))).toBe(
        "2026-09-22T05:30:00.000Z"
      );
    }
  });

  it("is not what the old `new Date(value)` did — that read the device's clock", () => {
    // Kept as a guard with teeth: this is the exact expression that shipped the
    // seven-hour error, and it must never again agree with the real conversion.
    const naive = onDeviceIn("America/New_York", () => new Date("2026-09-22T08:30").toISOString());
    expect(naive).not.toBe(israelLocalValueToIso("2026-09-22T08:30"));
  });

  it("tolerates seconds and surrounding blanks", () => {
    expect(israelLocalValueToIso(" 2026-09-22T08:30:00 ")).toBe("2026-09-22T05:30:00.000Z");
  });

  it("is empty for blank, date-only and unparseable values, so callers guard on falsy", () => {
    expect(israelLocalValueToIso("")).toBe("");
    expect(israelLocalValueToIso(null)).toBe("");
    expect(israelLocalValueToIso("2026-09-22")).toBe("");
    expect(israelLocalValueToIso("not a time")).toBe("");
  });

  it("israelLocalValueToDate mirrors it, with null where the ISO form is empty", () => {
    expect(israelLocalValueToDate("2026-09-22T08:30")?.toISOString()).toBe("2026-09-22T05:30:00.000Z");
    expect(israelLocalValueToDate("")).toBeNull();
    expect(israelLocalValueToDate("nonsense")).toBeNull();
  });
});

describe("toIsraelLocalValue — prefilling a form from a stored instant", () => {
  it("renders the hour a clock in Israel showed, not the device's", () => {
    for (const timeZone of AWAY) {
      expect(onDeviceIn(timeZone, () => toIsraelLocalValue("2026-09-22T05:30:00.000Z"))).toBe(
        "2026-09-22T08:30"
      );
    }
  });

  it("round-trips: open an editor on a stored shift, save it untouched, same instant", () => {
    const stored = "2026-02-11T21:45:00.000Z";
    expect(israelLocalValueToIso(toIsraelLocalValue(stored))).toBe(stored);
  });

  it("crossing midnight in Israel moves the DATE too, not just the hour", () => {
    // 21:30Z on 31 August is already 00:30 on 1 September in Israel.
    expect(toIsraelLocalValue("2026-08-31T21:30:00.000Z")).toBe("2026-09-01T00:30");
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(toIsraelLocalValue(new Date("2026-09-22T05:30:00.000Z"))).toBe("2026-09-22T08:30");
  });

  it("is empty for null, undefined and unparseable input", () => {
    expect(toIsraelLocalValue(null)).toBe("");
    expect(toIsraelLocalValue(undefined)).toBe("");
    expect(toIsraelLocalValue("rubbish")).toBe("");
  });
});

describe("DST", () => {
  it("knows the offset on both sides of the changeover", () => {
    expect(israelOffsetMinutes(new Date("2026-01-15T12:00:00Z"))).toBe(120);
    expect(israelOffsetMinutes(new Date("2026-07-15T12:00:00Z"))).toBe(180);
  });

  it("an hour that does not exist (02:30 on spring-forward night) still resolves", () => {
    // Israel jumps 02:00 to 03:00 on 2026-03-27, so 02:30 was never on a clock.
    // It has to land on a real instant rather than NaN; 03:30 local is the answer.
    const at = israelWallClockToUtc(2026, 3, 27, 2, 30);
    expect(at.toISOString()).toBe("2026-03-27T00:30:00.000Z");
    expect(toIsraelLocalValue(at)).toBe("2026-03-27T03:30");
  });

  it("an hour that happens twice (autumn) resolves to one of them, deterministically", () => {
    const at = israelWallClockToUtc(2026, 10, 25, 1, 30);
    expect(Number.isNaN(at.getTime())).toBe(false);
    expect(toIsraelLocalValue(at)).toBe("2026-10-25T01:30");
  });
});

describe("israelDateKey — today, for the business", () => {
  it("has already turned over when Israel's day has, though UTC's has not", () => {
    expect(israelDateKey(new Date("2026-08-31T22:30:00Z"))).toBe("2026-09-01");
    expect(israelDateKey(new Date("2026-08-31T12:00:00Z"))).toBe("2026-08-31");
  });

  it("does not follow the device abroad into yesterday or tomorrow", () => {
    // 20:00 on the 21st in Los Angeles is already the 22nd in Israel — and the
    // naive toISOString().slice(0, 10) this replaced got that right only by
    // accident, and got Israeli small hours wrong the other way.
    const evening = new Date("2026-09-22T03:00:00Z");
    for (const timeZone of AWAY) {
      expect(onDeviceIn(timeZone, () => israelDateKey(evening))).toBe("2026-09-22");
    }
  });
});

/**
 * The bug these lock down: forms defaulted "today" to the UTC date, which is
 * still YESTERDAY from Israeli midnight until 02:00 (winter) or 03:00 (summer).
 * A project opened at 02:00 on 8 October 2026 came up dated the 7th.
 */
describe("israelDateKey — around midnight in Israel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the night it was caught: 02:00 on 8 Oct (summer time) is the 8th, where UTC still said the 7th", () => {
    const at = new Date("2026-10-07T23:00:00Z");
    expect(israelDateKey(at)).toBe("2026-10-08");
    expect(at.toISOString().slice(0, 10)).toBe("2026-10-07");
  });

  it("winter (IST, +2): the day turns at 22:00Z", () => {
    expect(israelDateKey(new Date("2026-01-14T21:59:59Z"))).toBe("2026-01-14");
    expect(israelDateKey(new Date("2026-01-14T22:00:00Z"))).toBe("2026-01-15");
  });

  it("summer (IDT, +3): the day turns at 21:00Z", () => {
    expect(israelDateKey(new Date("2026-07-14T20:59:59Z"))).toBe("2026-07-14");
    expect(israelDateKey(new Date("2026-07-14T21:00:00Z"))).toBe("2026-07-15");
  });

  it("is already tomorrow for the whole stretch between Israeli and UTC midnight", () => {
    // Every quarter hour from Israel's midnight until UTC's, in both seasons:
    // the stretch where the old UTC date was a day behind.
    const stretches = [
      { from: "2026-01-14T22:00:00Z", to: "2026-01-15T00:00:00Z", israel: "2026-01-15", utc: "2026-01-14" },
      { from: "2026-07-14T21:00:00Z", to: "2026-07-15T00:00:00Z", israel: "2026-07-15", utc: "2026-07-14" },
    ];
    for (const { from, to, israel, utc } of stretches) {
      for (let t = Date.parse(from); t < Date.parse(to); t += 15 * 60_000) {
        expect(israelDateKey(new Date(t))).toBe(israel);
        expect(new Date(t).toISOString().slice(0, 10)).toBe(utc);
      }
    }
  });

  it("spring forward (Fri 27 Mar 2026, 02:00 → 03:00): that night starts on +2, the next on +3", () => {
    // Midnight going INTO the 27th is still winter time…
    expect(israelDateKey(new Date("2026-03-26T21:59:59Z"))).toBe("2026-03-26");
    expect(israelDateKey(new Date("2026-03-26T22:00:00Z"))).toBe("2026-03-27");
    // …and the missing hour itself belongs to the 27th.
    expect(israelDateKey(new Date("2026-03-27T00:30:00Z"))).toBe("2026-03-27");
    // Midnight going into the 28th is already summer time.
    expect(israelDateKey(new Date("2026-03-27T20:59:59Z"))).toBe("2026-03-27");
    expect(israelDateKey(new Date("2026-03-27T21:00:00Z"))).toBe("2026-03-28");
  });

  it("fall back (Sun 25 Oct 2026, 02:00 → 01:00): that night starts on +3, the next on +2", () => {
    expect(israelDateKey(new Date("2026-10-24T20:59:59Z"))).toBe("2026-10-24");
    expect(israelDateKey(new Date("2026-10-24T21:00:00Z"))).toBe("2026-10-25");
    // 01:30 happens twice that night — both are the 25th.
    expect(israelDateKey(new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
    expect(israelDateKey(new Date("2026-10-24T23:30:00Z"))).toBe("2026-10-25");
    // The next midnight is back on winter time.
    expect(israelDateKey(new Date("2026-10-25T21:59:59Z"))).toBe("2026-10-25");
    expect(israelDateKey(new Date("2026-10-25T22:00:00Z"))).toBe("2026-10-26");
  });

  it("rolls the month and the year with it", () => {
    expect(israelDateKey(new Date("2026-12-31T21:59:59Z"))).toBe("2026-12-31");
    expect(israelDateKey(new Date("2026-12-31T22:00:00Z"))).toBe("2027-01-01");
    expect(israelDateKey(new Date("2026-04-30T21:00:00Z"))).toBe("2026-05-01");
  });

  it("gives the same answer whatever time zone the device (or server) is set to", () => {
    const midnights = [
      { at: "2026-01-14T22:00:00Z", israel: "2026-01-15" },
      { at: "2026-07-14T21:00:00Z", israel: "2026-07-15" },
      { at: "2026-10-07T23:00:00Z", israel: "2026-10-08" },
    ];
    for (const timeZone of [...AWAY, "Asia/Jerusalem"]) {
      for (const { at, israel } of midnights) {
        expect(onDeviceIn(timeZone, () => israelDateKey(new Date(at)))).toBe(israel);
      }
    }
  });

  it("with no argument reads the clock — the form defaults call it that way", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T23:00:00Z"));
    expect(israelDateKey()).toBe("2026-10-08");
    vi.setSystemTime(new Date("2026-01-14T22:30:00Z"));
    expect(israelDateKey()).toBe("2026-01-15");
  });
});

describe("nowIsraelLocalValue", () => {
  it("matches the current instant on Israel's clock", () => {
    expect(nowIsraelLocalValue()).toBe(toIsraelLocalValue(new Date()));
  });

  it("offsetMinutes shifts it — an editor defaulting to an hour ago", () => {
    const before = israelLocalValueToDate(nowIsraelLocalValue(-60))!.getTime();
    const now = israelLocalValueToDate(nowIsraelLocalValue())!.getTime();
    expect(now - before).toBe(60 * 60 * 1000);
  });
});

describe("isDeviceClockOnIsraelTime", () => {
  function withDeviceOffset<T>(minutesWestOfUtc: number, run: () => T): T {
    const original = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = () => minutesWestOfUtc;
    try {
      return run();
    } finally {
      Date.prototype.getTimezoneOffset = original;
    }
  }

  it("true when the device is +3 in summer", () => {
    expect(withDeviceOffset(-180, () => isDeviceClockOnIsraelTime(new Date("2026-07-15T12:00:00Z")))).toBe(true);
  });

  it("true when the device is +2 in winter", () => {
    expect(withDeviceOffset(-120, () => isDeviceClockOnIsraelTime(new Date("2026-01-15T12:00:00Z")))).toBe(true);
  });

  it("false for a device abroad — this is what raises the שעון ישראל note", () => {
    expect(withDeviceOffset(240, () => isDeviceClockOnIsraelTime(new Date("2026-07-15T12:00:00Z")))).toBe(false);
    expect(withDeviceOffset(0, () => isDeviceClockOnIsraelTime(new Date("2026-07-15T12:00:00Z")))).toBe(false);
  });

  it("false for a device on +3 in WINTER, when Israel is on +2", () => {
    expect(withDeviceOffset(-180, () => isDeviceClockOnIsraelTime(new Date("2026-01-15T12:00:00Z")))).toBe(false);
  });
});
