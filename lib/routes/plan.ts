// What the route planner (app/(app)/deliveries/route) sends and gets back, and
// the parts of it both the page and the server need. No server code here.
//
// Always the fastest route (owner, 2026-10-26: "I don't want the shortest
// route. I want the fastest always").

import { getCityRegion } from "@/lib/ui/cities";

export type RoutePoint = { lat: number; lng: number };

export type RouteEnd = { mode: "return" } | { mode: "last" } | { mode: "point"; point: RoutePoint };

export type RoutePlanRequest = {
  start: RoutePoint;
  end: RouteEnd;
  /**
   * In the order the list shows them — what "the list's order" is measured
   * by. `phase` is the cities' order ("ירושלים, then the north"); null for a
   * stop placed by a rule of its own (start or finish with it, moved by hand).
   */
  stops: Array<{ id: string; lat: number; lng: number; phase: number | null }>;
  /** "Visit a before b", by stop id: the stop to start or finish with, and stops moved by hand. */
  before: Array<[string, string]>;
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
    /** Google's fastest with none of the choices (cities' order, first / last, moves by hand) — only when there were any. */
    freeBest: RouteCost | null;
  };
  /** How many orders the stops can go in. */
  possibleOrders: number;
  /** How many full routes Google planned to choose this one from (its own search, and each first stop tried). */
  triedRoutes: number;
  /** The leaving time the times count from (ISO). */
  departure: string;
};

export const MAX_ROUTE_STOPS = 25;

/**
 * A step of the cities' order: a region (צפון / מרכז / דרום) or a city.
 * A stop goes to the step naming its city; else the step naming its region;
 * else to "everything else", after them.
 */
export function stopPhase(city: string, steps: readonly string[]): number {
  const byCity = steps.indexOf(city);
  if (byCity >= 0) return byCity;
  const region = getCityRegion(city);
  const byRegion = region ? steps.indexOf(region) : -1;
  return byRegion >= 0 ? byRegion : steps.length;
}

/** n! — how many orders n stops can go in. */
export function possibleOrders(count: number): number {
  let total = 1;
  for (let k = 2; k <= count; k++) total *= k;
  return total;
}

/**
 * The cities' order as "visit a before b" pairs (indexes into the stops):
 * every stop of one phase before every stop of the next phase that has any.
 * A stop with no phase is left out.
 */
export function phaseRules(phases: ReadonlyArray<number | null>): Array<[number, number]> {
  const used = Array.from(new Set(phases.filter((p): p is number => p !== null))).sort((a, b) => a - b);
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

/** The stop to start with before every other; the one to finish with after every other. */
export function firstLastRules(ids: readonly string[], first: string | null, last: string | null): Array<[string, string]> {
  const rules: Array<[string, string]> = [];
  for (const id of ids) {
    if (first && id !== first) rules.push([first, id]);
    if (last && id !== last && id !== first) rules.push([id, last]);
  }
  return rules;
}

/**
 * Stops moved by hand keep their place: everything above a moved stop stays
 * before it, everything below it after. The rest Google may still reorder
 * (owner, 2026-10-26: "manually switch something and then give me the best
 * options with my switch").
 */
export function pinnedRules(order: readonly string[], pinned: ReadonlySet<string>): Array<[string, string]> {
  const rules: Array<[string, string]> = [];
  order.forEach((id, at) => {
    if (!pinned.has(id)) return;
    order.forEach((other, k) => {
      if (k < at) rules.push([other, id]);
      else if (k > at) rules.push([id, other]);
    });
  });
  return rules;
}

/** Exactly this order. */
export function chainRules(order: readonly string[]): Array<[string, string]> {
  return order.slice(1).map((id, k) => [order[k], id]);
}

/** True when the rules ask for a circle ("a before b" and "b before a"), so no route fits them. */
export function rulesConflict(count: number, rules: ReadonlyArray<[number, number]>): boolean {
  const incoming = new Array<number>(count).fill(0);
  const next = Array.from({ length: count }, () => [] as number[]);
  for (const [a, b] of rules) {
    next[a].push(b);
    incoming[b] += 1;
  }
  const ready = incoming.flatMap((n, i) => (n === 0 ? [i] : []));
  let seen = 0;
  while (ready.length > 0) {
    const at = ready.pop()!;
    seen += 1;
    for (const b of next[at]) if (--incoming[b] === 0) ready.push(b);
  }
  return seen < count;
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
