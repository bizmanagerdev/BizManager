import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chainRules,
  firstLastRules,
  formatDistance,
  formatDuration,
  phaseRules,
  pinnedRules,
  possibleOrders,
  rulesConflict,
  stopPhase,
} from "@/lib/routes/plan";
import { decodePolyline } from "@/lib/routes/polyline";
import { dayClock, leavesTomorrow } from "@/app/(app)/deliveries/route/route-ui";
import {
  currentPosition,
  departureFrom,
  formatCount,
  locationError,
} from "@/app/(app)/deliveries/route/RoutePlanner";

// The route planner's order choices — the cities' order, the stop to start
// or finish with, stops moved by hand — its counts and its words.

describe("stopPhase", () => {
  it("puts a stop in the step naming its city, else its region, else with the rest at the end", () => {
    const steps = ["ירושלים", "צפון"];
    expect(stopPhase("ירושלים", steps)).toBe(0);
    expect(stopPhase("חיפה", steps)).toBe(1);
    expect(stopPhase("בני ברק", steps)).toBe(2);
  });

  it("a city's own step wins over its region's, wherever it stands", () => {
    // ירושלים is in מרכז; "מרכז, then ירושלים" still puts ירושלים second.
    expect(stopPhase("ירושלים", ["מרכז", "ירושלים"])).toBe(1);
    expect(stopPhase("בני ברק", ["מרכז", "ירושלים"])).toBe(0);
  });

});

describe("phaseRules", () => {
  it("every stop of a phase before every stop of the next phase that has any", () => {
    // Phase 1 is empty: phase 0 goes straight before phase 2.
    expect(phaseRules([0, 2, 0, 2])).toEqual([
      [0, 1],
      [0, 3],
      [2, 1],
      [2, 3],
    ]);
  });

  it("no rules without phases, and a stop with no phase is left out", () => {
    expect(phaseRules([0, 0, 0])).toEqual([]);
    expect(phaseRules([0, null, 1])).toEqual([[0, 2]]);
    expect(phaseRules([null, null])).toEqual([]);
  });
});

describe("possibleOrders", () => {
  it("n!", () => {
    expect(possibleOrders(1)).toBe(1);
    expect(possibleOrders(4)).toBe(24);
    expect(possibleOrders(6)).toBe(720);
  });
});

describe("the order rules", () => {
  it("the stop to start with goes before every other; the one to finish with after every other", () => {
    expect(firstLastRules(["a", "b", "c"], "b", null)).toEqual([
      ["b", "a"],
      ["b", "c"],
    ]);
    expect(firstLastRules(["a", "b", "c"], null, "a")).toEqual([
      ["b", "a"],
      ["c", "a"],
    ]);
    expect(firstLastRules(["a", "b", "c"], "a", "c").map((pair) => pair.join(">")).sort()).toEqual(["a>b", "a>c", "b>c"]);
  });

  it("a stop moved by hand keeps everything above it before it and everything below it after it", () => {
    expect(pinnedRules(["a", "b", "c", "d"], new Set(["c"]))).toEqual([
      ["a", "c"],
      ["b", "c"],
      ["c", "d"],
    ]);
    expect(pinnedRules(["a", "b"], new Set())).toEqual([]);
  });

  it("exactly this order", () => {
    expect(chainRules(["a", "b", "c"])).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });

  it("rules from one order never contradict; a circle does", () => {
    const order = ["a", "b", "c", "d"];
    const index = (id: string) => order.indexOf(id);
    const pinned = pinnedRules(order, new Set(["b", "d"])).map(([x, y]) => [index(x), index(y)] as [number, number]);
    expect(rulesConflict(4, pinned)).toBe(false);
    expect(
      rulesConflict(3, [
        [0, 1],
        [1, 2],
        [2, 0],
      ])
    ).toBe(true);
  });
});

describe("formatting", () => {
  it("durations and distances the way the page shows them", () => {
    expect(formatDuration(45 * 60)).toBe("45 דק׳");
    expect(formatDuration(125 * 60)).toBe("2:05 שע׳");
    expect(formatDistance(640)).toBe("640 מ׳");
    expect(formatDistance(4300)).toBe("4.3 ק״מ");
    expect(formatDistance(182_400)).toBe("182 ק״מ");
  });

  it("large counts in words", () => {
    expect(formatCount(40320)).toBe("40,320");
    expect(formatCount(3_628_800)).toBe("3.6 מיליון");
    expect(formatCount(1.3e12)).toBe("1.3 טריליון");
    expect(formatCount(1.5e25)).toBe("יותר ממיליון מיליארד");
  });
});

describe("decodePolyline", () => {
  it("reads Google's own example line", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });
});

describe("departureFrom", () => {
  // 10:00 in Israel on 26/10/2026 (UTC+2).
  const now = new Date("2026-10-26T08:00:00Z");

  it("empty means now", () => {
    expect(departureFrom("", now)).toBeNull();
  });

  it("a later hour is today, Israel time", () => {
    expect(departureFrom("13:30", now)?.toISOString()).toBe("2026-10-26T11:30:00.000Z");
  });

  it("an hour already gone is tomorrow", () => {
    expect(departureFrom("07:00", now)?.toISOString()).toBe("2026-10-27T05:00:00.000Z");
  });
});

describe("currentPosition (\"המיקום שלי\")", () => {
  /** A device that answers each ask in turn: a place, or a failure's code. */
  function device(answers: Array<number | "found">) {
    const asked: PositionOptions[] = [];
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (found: PositionCallback, failed: PositionErrorCallback, options: PositionOptions) => {
          asked.push(options);
          const answer = answers[asked.length - 1];
          if (answer === "found") found({ coords: { latitude: 31.8, longitude: 35.2 } } as GeolocationPosition);
          else failed({ code: answer } as GeolocationPositionError);
        },
      },
    });
    return asked;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the GPS's answer, asked once", async () => {
    const asked = device(["found"]);
    await expect(currentPosition()).resolves.toEqual({ lat: 31.8, lng: 35.2 });
    expect(asked.map((options) => options.enableHighAccuracy)).toEqual([true]);
  });

  it("GPS too slow or lost: the phone's coarser location instead", async () => {
    for (const code of [2, 3]) {
      const asked = device([code, "found"]);
      await expect(currentPosition()).resolves.toEqual({ lat: 31.8, lng: 35.2 });
      expect(asked.map((options) => options.enableHighAccuracy)).toEqual([true, false]);
    }
  });

  it("blocked: says so at once, without asking again", async () => {
    const asked = device([1]);
    await expect(currentPosition()).rejects.toThrow(locationError(1));
    expect(asked).toHaveLength(1);
  });

  it("nothing either way: why, in the words of the last answer", async () => {
    device([3, 2]);
    await expect(currentPosition()).rejects.toThrow(locationError(2));
  });

  it("each cause in its own words", () => {
    expect(locationError(1)).toContain("חסומה");
    expect(locationError(2)).toContain("GPS");
    expect(locationError(3)).toContain("זמן");
    expect(new Set([1, 2, 3, null].map(locationError)).size).toBe(4);
  });
});

describe("hours that say their day", () => {
  // 14:10 in Israel on 27/10/2026 (UTC+2).
  const now = new Date("2026-10-27T12:10:00Z");

  it("today's hour plain, tomorrow's with מחר, a later one with its date", () => {
    expect(dayClock("2026-10-27T15:30:00Z", now)).toBe("17:30");
    expect(dayClock("2026-10-28T05:00:00Z", now)).toBe("מחר 07:00");
    // 00:10 on the 28th is tomorrow too, though it's only ten hours away.
    expect(dayClock("2026-10-27T22:10:00Z", now)).toBe("מחר 00:10");
    expect(dayClock("2026-10-29T06:00:00Z", now)).toBe("29/10 08:00");
  });

  it("an hour gone by more than five minutes is tomorrow's", () => {
    expect(leavesTomorrow("07:00", "14:10")).toBe(true);
    expect(leavesTomorrow("13:50", "14:10")).toBe(true);
    expect(leavesTomorrow("14:07", "14:10")).toBe(false);
    expect(leavesTomorrow("16:00", "14:10")).toBe(false);
    // Just before midnight, an hour after it is tomorrow's; one before it isn't.
    expect(leavesTomorrow("00:10", "23:59")).toBe(true);
    expect(leavesTomorrow("23:59", "00:02")).toBe(false);
    expect(leavesTomorrow("", "14:10")).toBe(false);
  });

  it("agrees with the hour the plan is asked for", () => {
    for (const time of ["07:00", "13:50", "14:07", "16:00", "23:45"]) {
      const planned = departureFrom(time, now)!;
      const tomorrow = dayClock(planned.toISOString(), now).startsWith("מחר");
      expect([time, tomorrow]).toEqual([time, leavesTomorrow(time, "14:10")]);
    }
  });
});
