import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The delivery route planner's server side: whoever sees the deliveries may
// plan, the stops are checked, Google's route planner is asked as the service
// account with traffic on, and the route comes back with the two plans it's
// compared with — the list's order and the order without "first … then …".

const { requireRouteAccess, getAccessToken } = vi.hoisted(() => ({
  requireRouteAccess: vi.fn(),
  getAccessToken: vi.fn(),
}));
vi.mock("@/lib/auth/requireRouteAccess", () => ({ requireRouteAccess }));
vi.mock("firebase-admin/app", () => ({ cert: () => ({ getAccessToken }) }));

import { POST } from "@/app/api/deliveries/route-plan/route";
import { NOT_CONFIGURED, NOT_ENABLED, NO_PERMISSION, readOptimizedRoute } from "@/lib/routes/route-optimization";
import { firstStopTries } from "@/lib/routes/plan-route";

const ACCOUNT = JSON.stringify({ project_id: "bizh-66c16", client_email: "routes@bizh-66c16.iam.gserviceaccount.com", private_key: "k" });
const google = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const post = (body: unknown) =>
  POST(new Request("http://test/api/deliveries/route-plan", { method: "POST", body: JSON.stringify(body) }));

const START = { lat: 31.75, lng: 34.99 };
const STOPS = [
  { id: "jerusalem", lat: 31.78, lng: 35.21, phase: 0 },
  { id: "haifa", lat: 32.79, lng: 34.99, phase: 1 },
  { id: "tveria", lat: 32.79, lng: 35.53, phase: 1 },
];
const request = (overrides: Record<string, unknown> = {}) => ({
  start: START,
  end: { mode: "return" },
  stops: STOPS,
  objective: "time",
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

  it("refuses a request with no stops, too many, or a stop with no point", async () => {
    expect((await post(request({ stops: [] }))).status).toBe(400);
    const many = Array.from({ length: 26 }, (_, i) => ({ id: `s${i}`, lat: 31 + i / 100, lng: 35, phase: 0 }));
    expect((await post(request({ stops: many }))).status).toBe(400);
    expect((await post(request({ stops: [{ id: "x", lat: null, lng: 35, phase: 0 }] }))).status).toBe(400);
    expect((await post(request({ start: null }))).status).toBe(400);
    expect(google).not.toHaveBeenCalled();
  });

  it("asks Google's route planner as the service account, with traffic, leaving at the time asked", async () => {
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
    expect(body.model.globalStartTime).toBe(departure);
    expect(body.model.shipments.map((s) => s.label)).toEqual(["jerusalem", "haifa", "tveria"]);
    expect(body.model.shipments[0].deliveries[0].duration).toBe("600s");
    const [vehicle] = body.model.vehicles;
    expect(vehicle.startTimeWindows).toEqual([{ startTime: departure, endTime: departure }]);
    expect(vehicle.endLocation).toEqual(vehicle.startLocation);
    expect(vehicle.costPerHour).toBe(1);
    // Only map points and ids leave BizH.
    expect(JSON.stringify(body)).not.toMatch(/name|phone/i);
  });

  it("a route ending at its last stop has no end point; the shortest weighs kilometres", async () => {
    google.mockImplementation(async () => json(googleRoute([0, 1, 2], 600)));
    const res = await post(request({ end: { mode: "last" }, objective: "distance" }));
    expect(res.status).toBe(200);
    const [vehicle] = sent(google.mock.calls[0]).model.vehicles;
    expect(vehicle.endLocation).toBeUndefined();
    expect(vehicle.costPerKilometer).toBe(1);
    const result = await res.json();
    // No leg after the last stop; the route ends once that stop is done.
    expect(result.legs).toHaveLength(3);
    expect(result.finish).toBe("2026-10-27T07:40:00.000Z");
  });

  it("keeps «first … then …» and compares with the list's order and the free best order", async () => {
    google.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Sent;
      const r = rules(body);
      if (r === JSON.stringify([[0, 1], [0, 2]])) return json(googleRoute([0, 2, 1], 1000)); // the route, Jerusalem first
      if (r === JSON.stringify([[0, 1], [1, 2]])) return json(googleRoute([0, 1, 2], 1500)); // the list's order
      if (r === "[]") return json(googleRoute([1, 2, 0], 900)); // no rules
      throw new Error(`unexpected rules ${r}`);
    });
    const res = await post(request());
    expect(res.status).toBe(200);
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
    expect(result.possibleOrders).toBe(2);
  });

  it("with no «first … then …»: Google's search, each nearby first stop, and the list's order", async () => {
    google.mockImplementation(async () => json(googleRoute([0, 1, 2], 600)));
    const res = await post(request({ stops: STOPS.map((s) => ({ ...s, phase: 0 })) }));
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
    const res = await post(request({ stops: STOPS.map((s) => ({ ...s, phase: 0 })) }));
    const result = await res.json();
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
    const res = await post(request({ stops: STOPS.map((s) => ({ ...s, phase: 0 })) }));
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

describe("firstStopTries", () => {
  it("the stops nearest the start, nearest first, four at most", () => {
    const near = (km: number, phase = 0) => ({ lat: START.lat + km / 111, lng: START.lng, phase });
    expect(firstStopTries([near(50), near(5), near(20), near(80), near(10)], START)).toEqual([1, 4, 2, 0]);
  });

  it("only stops that may come first, and none when there's no choice", () => {
    expect(firstStopTries(STOPS, START)).toEqual([]);
    expect(firstStopTries(STOPS.slice(0, 2).map((s) => ({ ...s, phase: 0 })), START)).toEqual([]);
    // Jerusalem is nearest, but "the north first" leaves only Haifa and Tveria to start with.
    expect(firstStopTries([{ ...STOPS[0], phase: 1 }, { ...STOPS[1], phase: 0 }, { ...STOPS[2], phase: 0 }], START)).toEqual([1, 2]);
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
      objective: "time" as const,
      before: [],
      searchSec: 1,
    };
    expect(readOptimizedRoute(input, googleRoute([2, 0, 1], 600)).order).toEqual(["tveria", "jerusalem", "haifa"]);
  });
});
