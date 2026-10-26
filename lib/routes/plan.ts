// What the route planner (app/(app)/deliveries/route) sends and gets back, and
// the parts of it both the page and the server need. No server code here.

import { getCityRegion } from "@/lib/ui/cities";

export type RoutePoint = { lat: number; lng: number };

export type RouteEnd = { mode: "return" } | { mode: "last" } | { mode: "point"; point: RoutePoint };

export type RoutePlanRequest = {
  start: RoutePoint;
  end: RouteEnd;
  /** In the order the list shows them — what "the list's order" is measured by. */
  stops: Array<{ id: string; lat: number; lng: number; phase: number }>;
  /** Fastest (driving time) or shortest (kilometres). */
  objective: "time" | "distance";
  /** When the driver leaves (ISO); null for now. */
  departure: string | null;
  /** Minutes spent at each stop. */
  serviceMinutes: number;
};

export type RouteCost = { durationSec: number; distanceM: number };

export type RouteLeg = {
  durationSec: number;
  distanceM: number;
  polyline: string | null;
  /** Google had no traffic for this leg: its time is on empty roads. */
  trafficUnavailable: boolean;
};

export type RoutePlanResult = {
  /** Stop ids in visiting order. */
  order: string[];
  /** Start → first stop, …, last stop → end (no last leg when the route ends at its last stop). */
  legs: RouteLeg[];
  /** When the driver reaches each stop (ISO), in visiting order — Google's, with traffic. */
  arrivals: string[];
  /** When the route ends (ISO). */
  finish: string;
  /** The driving alone. */
  total: RouteCost;
  /** The same stops, leaving time and traffic, planned other ways — for "why this route". */
  compare: {
    /** The stops in the order the list shows them. */
    listOrder: RouteCost | null;
    /** Google's best order with no "first … then …" — only when one was asked for. */
    freeBest: RouteCost | null;
  };
  /** How many orders there were to choose from. */
  possibleOrders: number;
  /** How many full routes Google planned to choose this one from (its own search, and each first stop tried). */
  triedRoutes: number;
  /** The leaving time the times count from (ISO). */
  departure: string;
};

export const MAX_ROUTE_STOPS = 25;

/**
 * A step of "first …, then …": a region (צפון / מרכז / דרום) or a city.
 * A stop goes to the step naming its city; else the step naming its region;
 * else to "everything else", at the end or the start of the route.
 */
export function stopPhase(city: string, steps: readonly string[], restFirst = false): number {
  const offset = restFirst ? 1 : 0;
  const byCity = steps.indexOf(city);
  if (byCity >= 0) return byCity + offset;
  const region = getCityRegion(city);
  const byRegion = region ? steps.indexOf(region) : -1;
  if (byRegion >= 0) return byRegion + offset;
  return restFirst ? 0 : steps.length;
}

/**
 * How many orders there are to choose from: n! with no phases, and with
 * phases the product of each phase's own count (their order is fixed).
 */
export function possibleOrders(phases: readonly number[]): number {
  const sizes = new Map<number, number>();
  for (const phase of phases) sizes.set(phase, (sizes.get(phase) ?? 0) + 1);
  let total = 1;
  for (const size of sizes.values()) for (let k = 2; k <= size; k++) total *= k;
  return total;
}

/**
 * The phases as "visit a before b" pairs (indexes into the stops): every stop
 * of one phase before every stop of the next phase that has any.
 */
export function phaseRules(phases: readonly number[]): Array<[number, number]> {
  const used = Array.from(new Set(phases)).sort((a, b) => a - b);
  const rules: Array<[number, number]> = [];
  for (let k = 1; k < used.length; k++) {
    phases.forEach((p, a) => {
      if (p !== used[k - 1]) return;
      phases.forEach((q, b) => {
        if (q === used[k]) rules.push([a, b]);
      });
    });
  }
  return rules;
}

/** "2:05 שע׳" / "45 דק׳" */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} דק׳`;
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, "0")} שע׳`;
}

/** "182 ק״מ" / "4.3 ק״מ" / "650 מ׳" */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} מ׳`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString("he-IL")} ק״מ`;
}
