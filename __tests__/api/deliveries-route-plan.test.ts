import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The delivery route planner's server side: whoever sees the deliveries may
// plan, the stops and the order rules are checked, Google's route planner is
// asked as the service account with traffic on — always the fastest — and the
// route comes back with the plans it's compared with: the list's order and
// Google's fastest without the person's choices.

const { requireRouteAccess, getAccessToken } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  getAccessToken: vi.fn(),
}));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("firebase-admin/app", () => ({ cert: () => ({ getAccessToken }) }));

import { POST } from "@/app/api/deliveries/route-plan/route";
import { googleTime, NOT_CONFIGURED, NOT_ENABLED, NO_PERMISSION, readOptimizedRoute } from "@/lib/routes/route-optimization";
import { firstStopTries, leavingAt } from "@/lib/routes/plan-route";

const ACCOUNT = JSON.stringify({ project_id: "bizh-66c16", client_email: "routes@bizh-66c16.iam.gserviceaccount.com", private_key: "k" });
const google = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const post = (body: unknown) =>
  POST(new Request("http://test/api/deliveries/route-plan", { method: "POST", body: JSON.stringify(body) }));

const START = { lat: 31.75, lng: 34.99 };
/** Jerusalem first, then the north (the cities' order). */
const STOPS = [
  { id: "jerusalem", lat: 31.78, lng: 35.21, phase: 0 },
  { id: "haifa", lat: 32.79, lng: 34.99, phase: 1 },
  { id: "tveria", lat: 32.79, lng: 35.53, phase: 1 },
];
const FREE = STOPS.map((s) => ({ ...s, phase: null }));
const request = (overrides: Record<string, unknown> = {}) => ({
  start: START,
  end: { mode: "return" },
  stops: STOPS,
  before: [],
  departure: null,
  serviceMinutes: 10,
  ...overrides,
});

type Sent = {
  model: {
    shipments: Array<{ label: string; deliveries: Array<{ duration: string; arrivalLocation: unknown }> }>;
    vehicles: Array<Record<string, unknown>>;
    precedenceRules: Array<{ firstIndex: number; secondIndex: number }>;
    globalStartTime: string;
    globalEndTime: string;
  };
  considerRoadTraffic: boolean;
  populateTransitionPolylines: boolean;
};
const sent = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string) as Sent;

/** Google's answer for visiting the shipments in `order`, every leg `legSec` long. */
function googleRoute(order: number[], legSec: number) {
  return {
    routes: [
      {
        vehicleEndTime: "2026-10-27T09:00:00Z",
        // Google leaves a zero index out, and labels can be missing.
        visits: order.map((index, k) => ({ ...(index ? { shipmentIndex: index } : {}), startTime: `2026-10-27T07:${10 + k * 10}:00Z` })),
        transitions: [...order, -1].map(() => ({
          travelDuration: `${legSec}s`,
          travelDistanceMeters: 1000,
          routePolyline: { points: "_p~iF~ps|U" },
        })),
      },
    ],
  };
}

const rules = (body: Sent) => JSON.stringify(body.model.precedenceRules.map((r) => [r.firstIndex, r.secondIndex]));

beforeEach(() => {
  requireRouteAccess.mockReset();
  requireRouteAccess.mockResolvedValue({
    ok: true,
    value: { supabase: {}, user: { id: "auth-1" }, profile: { id: "u1", role: "admin", section_access: {} } },
  });
  getAccessToken.mockReset();
  getAccessToken.mockResolvedValue({ access_token: "token-1" });
  google.mockReset();
  vi.stubGlobal("fetch", google);
  process.env.GOOGLE_ROUTE_OPTIMIZATION_SA_JSON = ACCOUNT;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_ROUTE_OPTIMIZATION_SA_JSON;
});

describe("POST /api/deliveries/route-plan", () => {
  it("is for signed-in people only", async () => {
    requireRouteAccess.mockResolvedValue({ ok: false, response: json({ error: "Unauthorized" }, 401) });
    const res = await post(request());
    expect(res.status).toBe(401);
    expect(google).not.toHaveBeenCalled();
  });

  it("and only for someone who can see the deliveries", async () => {
    requireRouteAccess.mockResolvedValue({
      ok: true,
      value: { supabase: {}, user: { id: "auth-2" }, profile: { id: "w1", role: "worker", section_access: { deliveries: false } } },
    });
    const res = await post(request());
    expect(res.status).toBe(403);
    expect(google).not.toHaveBeenCalled();
  });

  it("a worker with the deliveries plans too", async () => {
    requireRouteAccess.mockResolvedValue({
      ok: true,
      value: { supabase: {}, user: { id: "auth-3" }, profile: { id: "w2", role: "worker", section_access: { deliveries: true } } },
    });
    google.mockImplementation(async () => json(googleRoute([0, 1, 2], 600)));
    expect((await post(request())).status).toBe(200);
  });

  it("refuses a request with no stops, too many, a stop with no point, or a rule for a stop not in it", async () => {
    expect((await post(request({ stops: [] }))).status).toBe(400);
    const many = Array.from({ length: 26 }, (_, i) => ({ id: `s${i}`, lat: 31 + i / 100, lng: 35, phase: null }));
    expect((await post(request({ stops: many }))).status).toBe(400);
    expect((await post(request({ stops: [{ id: "x", lat: null, lng: 35, phase: null }] }))).status).toBe(400);
    expect((await post(request({ start: null }))).status).toBe(400);
    expect((await post(request({ before: [["jerusalem", "eilat"]] }))).status).toBe(400);
    expect(google).not.toHaveBeenCalled();
  });

  it("refuses choices that contradict each other, without asking Google", async () => {
    // The cities' order puts Jerusalem first; a move by hand puts Haifa before it — and Jerusalem before Haifa.
    const res = await post(request({ before: [["haifa", "jerusalem"]] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("סותר");
    expect(google).not.toHaveBeenCalled();
  });

  it("asks Google's route planner as the service account, with traffic, always the fastest, leaving at the time asked", async () => {
    google.mockImplementation(async () => json(googleRoute([0, 2, 1], 600)));
    const departure = new Date(Date.now() + 3 * 3600_000).toISOString();
    const res = await post(request({ departure }));
    expect(res.status).toBe(200);

    const [url, init] = google.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://routeoptimization.googleapis.com/v1/projects/bizh-66c16:optimizeTours");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-1");
    const body = sent(google.mock.calls[0]);
    expect(body.considerRoadTraffic).toBe(true);
    expect(body.populateTransitionPolylines).toBe(true);
    // Whole seconds: Google refuses a time with milliseconds ("nanos must be unset").
    expect(body.model.globalStartTime).toBe(departure.replace(/\.\d{3}Z$/, "Z"));
    expect(body.model.globalEndTime).toMatch(/:\d\dZ$/);
    expect(body.model.shipments.map((s) => s.label)).toEqual(["jerusalem", "haifa", "tveria"]);
    expect(body.model.shipments[0].deliveries[0].duration).toBe("600s");
    const [vehicle] = body.model.vehicles;
    expect(vehicle.startTimeWindows).toEqual([{ startTime: body.model.globalStartTime, endTime: body.model.globalStartTime }]);
    expect(vehicle.endLocation).toEqual(vehicle.startLocation);
    expect(vehicle.costPerHour).toBe(1);
    expect(vehicle.costPerKilometer).toBeUndefined();
    // Only map points and ids leave BizH.
    expect(JSON.stringify(body)).not.toMatch(/name|phone/i);
  });

  it("leaving now: the next whole minute, so Google takes the time", async () => {
    google.mockImplementation(async () => json(googleRoute([0, 1, 2], 600)));
    await post(request({ stops: FREE }));
    const start = sent(google.mock.calls[0]).model.globalStartTime;
    expect(start).toMatch(/T\d\d:\d\d:00Z$/);
    expect(new Date(start).getTime()).toBeGreaterThan(Date.now());
  });

  it("a route ending at its last stop has no end point and no leg after it", async () => {
    google.mockImplementation(async () => json(googleRoute([0, 1, 2], 600)));
    const res = await post(request({ end: { mode: "last" } }));
    expect(res.status).toBe(200);
    const [vehicle] = sent(google.mock.calls[0]).model.vehicles;
    expect(vehicle.endLocation).toBeUndefined();
    const result = await res.json();
    expect(result.legs).toHaveLength(3);
    // The route ends once the last stop is done.
    expect(result.finish).toBe("2026-10-27T07:40:00.000Z");
  });

  it("keeps the cities' order and compares with the list's order and the fastest without it", async () => {
    google.mockImplementation(async (_url: string, init: RequestInit) => {
      const r = rules(JSON.parse(init.body as string) as Sent);
      if (r === JSON.stringify([[0, 1], [0, 2]])) return json(googleRoute([0, 2, 1], 1000)); // the route, Jerusalem first
      if (r === JSON.stringify([[0, 1], [1, 2]])) return json(googleRoute([0, 1, 2], 1500)); // the list's order
      if (r === "[]") return json(googleRoute([1, 2, 0], 900)); // no choices
      throw new Error(`unexpected rules ${r}`);
    });
    const res = await post(request());
    expect(res.status).toBe(200);
    // Only Jerusalem may come first, so no first stops are tried.
    expect(google).toHaveBeenCalledTimes(3);
    const result = await res.json();
    expect(result.order).toEqual(["jerusalem", "tveria", "haifa"]);
    expect(result.legs).toHaveLength(4);
    expect(result.legs[0]).toMatchObject({ durationSec: 1000, distanceM: 1000, polyline: "_p~iF~ps|U", trafficUnavailable: false });
    expect(result.total).toEqual({ durationSec: 4000, distanceM: 4000 });
    expect(result.compare).toEqual({
      listOrder: { durationSec: 6000, distanceM: 4000 },
      freeBest: { durationSec: 3600, distanceM: 4000 },
    });
    expect(result.arrivals).toEqual(["2026-10-27T07:10:00Z", "2026-10-27T07:20:00Z", "2026-10-27T07:30:00Z"]);
    expect(result.possibleOrders).toBe(6);
  });

  it("a stop moved by hand or asked to come first is sent as a rule", async () => {
    google.mockImplementation(async () => json(googleRoute([2, 0, 1], 600)));
    // Tveria first, by id; no cities' order.
    const res = await post(request({ stops: FREE, before: [["tveria", "jerusalem"], ["tveria", "haifa"]] }));
    expect(res.status).toBe(200);
    expect(rules(sent(google.mock.calls[0]))).toBe(JSON.stringify([[2, 0], [2, 1]]));
    // Tveria is the only stop that may come first: nothing else to try first.
    expect(google).toHaveBeenCalledTimes(3);
  });

  it("with no choices: Google's search, each nearby first stop, and the list's order", async () => {
    google.mockImplementation(async () => json(googleRoute([0, 1, 2], 600)));
    const res = await post(request({ stops: FREE }));
    expect(res.status).toBe(200);
    // 1 search + 3 first stops + the list's order.
    expect(google).toHaveBeenCalledTimes(5);
    const result = await res.json();
    expect(result.compare.freeBest).toBeNull();
    expect(result.triedRoutes).toBe(4);
  });

  it("keeps the fastest of Google's own search and the first stops tried", async () => {
    // Google's search settles on a slower route than one starting at Tveria (as it did with real stops).
    google.mockImplementation(async (_url: string, init: RequestInit) => {
      const r = rules(JSON.parse(init.body as string) as Sent);
      if (r === "[]") return json(googleRoute([0, 1, 2], 1000));
      if (r === JSON.stringify([[2, 0], [2, 1]])) return json(googleRoute([2, 0, 1], 700));
      return json(googleRoute([0, 1, 2], 1500));
    });
    const result = await (await post(request({ stops: FREE }))).json();
    expect(result.order).toEqual(["tveria", "jerusalem", "haifa"]);
    expect(result.total.durationSec).toBe(2800);
  });

  it("a comparison that fails doesn't fail the route", async () => {
    google.mockImplementation(async (_url: string, init: RequestInit) => {
      const r = rules(JSON.parse(init.body as string) as Sent);
      return r === JSON.stringify([[0, 1], [0, 2]]) ? json(googleRoute([0, 2, 1], 1000)) : json({ error: { status: "INTERNAL" } }, 500);
    });
    const res = await post(request());
    expect(res.status).toBe(200);
    expect((await res.json()).compare).toEqual({ listOrder: null, freeBest: null });
  });

  it("names the stops Google couldn't fit in", async () => {
    google.mockImplementation(async () => json({ ...googleRoute([0, 1], 600), skippedShipments: [{ index: 2, label: "tveria" }] }));
    const res = await post(request({ stops: FREE }));
    expect(res.status).toBe(422);
    expect((await res.json()).unreachable).toEqual(["tveria"]);
  });

  it("says what's missing in Google Cloud: the account, the API, the role", async () => {
    delete process.env.GOOGLE_ROUTE_OPTIMIZATION_SA_JSON;
    let res = await post(request());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: NOT_CONFIGURED, setup: true });
    expect(google).not.toHaveBeenCalled();

    process.env.GOOGLE_ROUTE_OPTIMIZATION_SA_JSON = ACCOUNT;
    google.mockResolvedValue(json({ error: { status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } }, 403));
    res = await post(request());
    expect(await res.json()).toMatchObject({ error: NOT_ENABLED, setup: true });

    google.mockResolvedValue(json({ error: { status: "PERMISSION_DENIED", details: [{ reason: "IAM_PERMISSION_DENIED" }] } }, 403));
    res = await post(request());
    expect(await res.json()).toMatchObject({ error: NO_PERMISSION, setup: true });
  });
});

describe("times Google takes", () => {
  it("whole seconds, no milliseconds", () => {
    expect(googleTime(new Date("2026-10-26T21:43:47.437Z"))).toBe("2026-10-26T21:43:47Z");
  });

  it("leaving now is the next whole minute; a time asked is kept, to the second", () => {
    const now = new Date("2026-10-26T21:43:47.437Z");
    expect(leavingAt(null, now).toISOString()).toBe("2026-10-26T21:45:00.000Z");
    expect(leavingAt("2026-10-27T05:30:00.250Z", now).toISOString()).toBe("2026-10-27T05:30:00.000Z");
    // A time already gone is now.
    expect(leavingAt("2026-10-26T08:00:00.000Z", now).toISOString()).toBe("2026-10-26T21:45:00.000Z");
  });
});

describe("firstStopTries", () => {
  it("the stops nearest the start, nearest first, four at most", () => {
    const near = (km: number) => ({ lat: START.lat + km / 111, lng: START.lng });
    expect(firstStopTries([near(50), near(5), near(20), near(80), near(10)], START)).toEqual([1, 4, 2, 0]);
  });

  it("only stops no rule makes wait, and none when there's no choice", () => {
    // Jerusalem must come before the others: it's the only one that can start.
    expect(firstStopTries(STOPS, START, [[0, 1], [0, 2]])).toEqual([]);
    expect(firstStopTries(STOPS.slice(0, 2), START)).toEqual([]);
    // Jerusalem is nearest, but it must wait for Haifa: Haifa and Tveria can start.
    expect(firstStopTries(STOPS, START, [[1, 0]])).toEqual([1, 2]);
  });
});

describe("readOptimizedRoute", () => {
  it("reads a shipment by its index when Google leaves the label out", () => {
    const input = {
      start: START,
      end: START,
      stops: STOPS,
      serviceSec: 0,
      departure: new Date("2026-10-27T07:00:00Z"),
      before: [],
      searchSec: 1,
    };
    expect(readOptimizedRoute(input, googleRoute([2, 0, 1], 600)).order).toEqual(["tveria", "jerusalem", "haifa"]);
  });
});
