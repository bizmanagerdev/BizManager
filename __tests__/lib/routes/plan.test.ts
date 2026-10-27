import { describe, expect, it } from "vitest";
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
import { departureFrom, formatCount, googleMapsLinks } from "@/app/(app)/deliveries/route/RoutePlanner";

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

describe("googleMapsLinks", () => {
  const points = Array.from({ length: 13 }, (_, i) => ({ lat: 31 + i / 100, lng: 35 }));

  it("one link up to 9 stops between start and end", () => {
    const links = googleMapsLinks(points.slice(0, 11));
    expect(links).toHaveLength(1);
    const url = new URL(links[0]);
    expect(url.searchParams.get("origin")).toBe("31,35");
    expect(url.searchParams.get("destination")).toBe("31.1,35");
    expect(url.searchParams.get("waypoints")?.split("|")).toHaveLength(9);
  });

  it("more stops: parts that carry on from where the last one ended", () => {
    const links = googleMapsLinks(points);
    expect(links).toHaveLength(2);
    expect(new URL(links[1]).searchParams.get("origin")).toBe(new URL(links[0]).searchParams.get("destination"));
    expect(new URL(links[1]).searchParams.get("destination")).toBe("31.12,35");
  });
});
