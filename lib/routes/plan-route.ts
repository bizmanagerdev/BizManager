// One route plan, on the server, from Google's route planner
// (lib/routes/route-optimization.ts). Called by app/api/deliveries/route-plan.
//
// Google's search can settle on a route a little slower than one it would
// itself rate better (found 2026-10-26 with six real stops: it kept a route
// 3 minutes slower, even given 12 seconds or the better route to start from).
// So the route is asked for several ways at once — Google's own search, and
// the route starting at each of the stops nearest the start — and the fastest
// by Google's own traffic times is kept.
//
// Beside it, to show why it's the best: the stops in the list's order and,
// when "first … then …" was asked, the best order without it. If either of
// those fails the route still comes back.

import { optimizeRoute, type LatLng, type OptimizedRoute, type OptimizeInput } from "@/lib/routes/route-optimization";
import {
  MAX_ROUTE_STOPS,
  phaseRules,
  possibleOrders,
  type RouteEnd,
  type RoutePlanRequest,
  type RoutePlanResult,
} from "@/lib/routes/plan";

export class RoutePlanError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** How long Google may search for the best order. */
const SEARCH_SEC = 4;
/** How many of the stops nearest the start are each tried as the first stop. */
const FIRST_STOP_TRIES = 4;

const coord = (value: unknown, limit: number): number | null =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit && value !== 0 ? value : null;

function point(value: unknown): LatLng | null {
  const v = value as { lat?: unknown; lng?: unknown } | null;
  const lat = coord(v?.lat, 90);
  const lng = coord(v?.lng, 180);
  return lat !== null && lng !== null ? { lat, lng } : null;
}

/** The request as it came in, checked; throws a RoutePlanError for anything not right. */
export function parseRoutePlanRequest(body: unknown): RoutePlanRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const start = point(b.start);
  if (!start) throw new RoutePlanError("חסרה נקודת יציאה.", 400);

  const endIn = (b.end ?? {}) as { mode?: unknown; point?: unknown };
  let end: RouteEnd;
  if (endIn.mode === "last") end = { mode: "last" };
  else if (endIn.mode === "point") {
    const at = point(endIn.point);
    if (!at) throw new RoutePlanError("חסרה נקודת סיום.", 400);
    end = { mode: "point", point: at };
  } else end = { mode: "return" };

  const stopsIn = Array.isArray(b.stops) ? b.stops : [];
  if (stopsIn.length === 0) throw new RoutePlanError("לא נבחרו עצירות למסלול.", 400);
  if (stopsIn.length > MAX_ROUTE_STOPS) {
    throw new RoutePlanError(`אפשר לתכנן עד ${MAX_ROUTE_STOPS} עצירות במסלול אחד. חלקו לשני מסלולים.`, 400);
  }
  const ids = new Set<string>();
  const stops = stopsIn.map((raw) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const id = typeof s.id === "string" ? s.id.trim().slice(0, 120) : "";
    const at = point(s);
    if (!id || !at || ids.has(id)) throw new RoutePlanError("אחת העצירות בלי מיקום על המפה.", 400);
    ids.add(id);
    const phase = typeof s.phase === "number" && Number.isInteger(s.phase) && s.phase >= 0 && s.phase < 50 ? s.phase : 0;
    return { id, lat: at.lat, lng: at.lng, phase };
  });

  const departure = typeof b.departure === "string" && !Number.isNaN(new Date(b.departure).getTime()) ? b.departure : null;
  const minutes = typeof b.serviceMinutes === "number" && Number.isFinite(b.serviceMinutes) ? b.serviceMinutes : 10;
  return {
    start,
    end,
    stops,
    objective: b.objective === "distance" ? "distance" : "time",
    departure,
    serviceMinutes: Math.min(120, Math.max(0, Math.round(minutes))),
  };
}

/** A leaving time to plan the traffic for: the one asked, up to a week ahead; else a minute from now. */
function leavingAt(value: string | null, now: Date): Date {
  const soon = new Date(now.getTime() + 60_000);
  if (!value) return soon;
  const at = new Date(value);
  return at.getTime() > soon.getTime() && at.getTime() - now.getTime() < 7 * 24 * 3600_000 ? at : soon;
}

/** Straight-line distance, only to tell which stops are near the start. */
function crowKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

/**
 * The stops tried as the first one: those nearest the start among the ones
 * that may come first ("first … then …"). None when there's no real choice.
 */
export function firstStopTries(stops: Array<LatLng & { phase: number }>, start: LatLng, limit = FIRST_STOP_TRIES): number[] {
  if (stops.length < 3) return [];
  const firstPhase = Math.min(...stops.map((stop) => stop.phase));
  const allowed = stops.map((stop, index) => ({ stop, index })).filter(({ stop }) => stop.phase === firstPhase);
  if (allowed.length < 2) return [];
  return allowed
    .sort((a, b) => crowKm(start, a.stop) - crowKm(start, b.stop) || a.index - b.index)
    .slice(0, limit)
    .map(({ index }) => index);
}

/** Stop `first` before every other stop. */
const firstOf = (first: number, count: number): Array<[number, number]> =>
  Array.from({ length: count }, (_, other) => other)
    .filter((other) => other !== first)
    .map((other) => [first, other]);

export async function planRoute(request: RoutePlanRequest, now: Date = new Date()): Promise<RoutePlanResult> {
  const { stops, end, start } = request;
  const n = stops.length;
  const phases = stops.map((stop) => stop.phase);
  const base: Omit<OptimizeInput, "before" | "searchSec"> = {
    start,
    end: end.mode === "point" ? end.point : end.mode === "return" ? start : null,
    stops: stops.map(({ id, lat, lng }) => ({ id, lat, lng })),
    serviceSec: request.serviceMinutes * 60,
    departure: leavingAt(request.departure, now),
    objective: request.objective,
  };
  const rules = phaseRules(phases);
  const listChain: Array<[number, number]> = stops.slice(1).map((_, k) => [k, k + 1]);
  const hasPhases = new Set(phases).size > 1;
  const tries = firstStopTries(stops, start);

  const [searched, firstStopRoutes, listOrder, free] = await Promise.all([
    optimizeRoute({ ...base, before: rules, searchSec: SEARCH_SEC }),
    Promise.all(
      tries.map((first) => optimizeRoute({ ...base, before: [...rules, ...firstOf(first, n)], searchSec: SEARCH_SEC }).catch(() => null))
    ),
    // The order is fixed, so Google answers as soon as it has timed it (1 s was too short for it: "deadline").
    n > 1 ? optimizeRoute({ ...base, before: listChain, searchSec: SEARCH_SEC, search: "first" }).catch(() => null) : null,
    hasPhases ? optimizeRoute({ ...base, before: [], searchSec: SEARCH_SEC }).catch(() => null) : null,
  ]);

  const measure = (plan: OptimizedRoute) => (request.objective === "distance" ? plan.distanceM : plan.durationSec);
  const best = (plans: Array<OptimizedRoute | null>): OptimizedRoute | null =>
    plans.reduce<OptimizedRoute | null>((kept, plan) => (plan && (!kept || measure(plan) < measure(kept)) ? plan : kept), null);

  // Google's own search first, so a tie keeps it.
  const route = best([searched, ...firstStopRoutes])!;
  // The route with "first … then …" is also a route without it: the best without is never worse.
  const freeBest = hasPhases && free ? best([free, route]) : null;
  const cost = (plan: OptimizedRoute | null) => (plan ? { durationSec: plan.durationSec, distanceM: plan.distanceM } : null);
  return {
    order: route.order,
    legs: route.legs,
    arrivals: route.arrivals,
    finish: route.finish,
    total: { durationSec: route.durationSec, distanceM: route.distanceM },
    compare: { listOrder: cost(listOrder), freeBest: cost(freeBest) },
    possibleOrders: possibleOrders(phases),
    triedRoutes: 1 + firstStopRoutes.filter(Boolean).length,
    departure: base.departure.toISOString(),
  };
}
