// Google's Route Optimization API — Google's own route planner, the one
// delivery fleets use (owner, 2026-10-26: "an AI that … knows how to plan a
// good route … if this area has traffic now and it won't have later, when I
// come there"). It orders the stops with Google's traffic, keeps the time spent
// at each stop and the "first … then …" rules, and gives back the arrival
// times and the road line of every leg.
//
// Asked from BizH's server only. Google takes no plain key for it: the server
// signs in as a service account (GOOGLE_ROUTE_OPTIMIZATION_SA_JSON — the JSON
// Google gives for it, or on a computer the path to that file), with the
// "Route Optimization Editor" role in the bizh-66c16 project. Only map points
// and times are sent: no customer name, phone or note.
//
// Billing (2026-10): per stop in each request — 5,000 stops a month free,
// then about 1¢ a stop. A plan asks up to 7 times (lib/routes/plan-route.ts):
// an 8-stop plan is about 56 stops.

import { readFileSync } from "node:fs";
import type { ServiceAccount } from "firebase-admin/app";

export type LatLng = { lat: number; lng: number };

export type OptimizeInput = {
  start: LatLng;
  /** Null: the route ends at its last stop. */
  end: LatLng | null;
  stops: Array<{ id: string; lat: number; lng: number }>;
  /** Time spent at each stop. */
  serviceSec: number;
  departure: Date;
  /** [first, second]: stop `first` is visited before stop `second` (indexes into stops). */
  before: Array<[number, number]>;
  /** How long Google may take. */
  searchSec: number;
  /** "best": search the whole time for a better order; "first": answer with the first good one (an order already fixed). */
  search?: "best" | "first";
};

export type OptimizedLeg = {
  durationSec: number;
  distanceM: number;
  /** Google's encoded line of the leg (lib/routes/polyline.ts). */
  polyline: string | null;
  /** Google had no traffic for this leg: its time is on empty roads. */
  trafficUnavailable: boolean;
};

export type OptimizedRoute = {
  /** Stop ids in visiting order. */
  order: string[];
  /** Start → first stop, …, last stop → end (no last leg when the route ends at its last stop). */
  legs: OptimizedLeg[];
  /** When the driver reaches each stop (ISO), in visiting order. */
  arrivals: string[];
  /** When the route ends (ISO). */
  finish: string;
  durationSec: number;
  distanceM: number;
};

export class OptimizationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Google Cloud isn't set up for it yet: the page says what's missing. */
    readonly setup = false,
    /** Stops Google couldn't fit in the route. */
    readonly unreachable: string[] = []
  ) {
    super(message);
  }
}

export const NOT_CONFIGURED =
  "תכנון המסלולים של Google עוד לא חובר לשרת (חסר חשבון השירות GOOGLE_ROUTE_OPTIMIZATION_SA_JSON).";
export const NOT_ENABLED = "Route Optimization API עדיין לא מופעל בפרויקט ה-Google Cloud של העסק.";
export const NO_PERMISSION = "לחשבון השירות של המסלולים חסר התפקיד Route Optimization Editor ב-Google Cloud.";

/** "1234s" → 1234 */
export function seconds(value: unknown): number {
  if (typeof value === "number") return value;
  const match = typeof value === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(value) : null;
  return match ? Number(match[1]) : 0;
}

type Account = ServiceAccount & { project_id?: string };
type Credential = { getAccessToken(): Promise<{ access_token: string }> };
let signedIn: { raw: string; projectId: string; credential: Credential } | null = null;

/** The service account, from the JSON itself (Vercel) or a path to its file (a computer's .env). */
function readAccount(raw: string): Account {
  const text = raw.trim().startsWith("{") ? raw : readFileSync(raw.trim(), "utf8");
  return JSON.parse(text) as Account;
}

async function signIn(): Promise<{ projectId: string; credential: Credential }> {
  const raw = process.env.GOOGLE_ROUTE_OPTIMIZATION_SA_JSON?.trim();
  if (!raw) throw new OptimizationError(NOT_CONFIGURED, 503, true);
  if (signedIn?.raw === raw) return signedIn;
  let account: Account;
  try {
    account = readAccount(raw);
  } catch {
    throw new OptimizationError("חשבון השירות של המסלולים לא תקין (GOOGLE_ROUTE_OPTIMIZATION_SA_JSON).", 503, true);
  }
  const projectId = account.project_id ?? account.projectId;
  if (!projectId) throw new OptimizationError("בחשבון השירות של המסלולים חסר project_id.", 503, true);
  // firebase-admin's credential (already here for push alerts) signs in with
  // the cloud-platform scope and renews its token by itself.
  const { cert } = await import("firebase-admin/app");
  signedIn = { raw, projectId, credential: cert(account) as unknown as Credential };
  return signedIn;
}

const location = (point: LatLng) => ({ latitude: point.lat, longitude: point.lng });

/**
 * A time as Google takes it: whole seconds. "…T09:30:00.437Z" is refused
 * ("nanos must be unset") — every plan made for "now" failed on 2026-10-26.
 */
export function googleTime(at: Date): string {
  return new Date(Math.floor(at.getTime() / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The request Google gets: one vehicle (the driver), one delivery per stop — always the fastest. */
export function optimizeToursBody(input: OptimizeInput) {
  const departure = googleTime(input.departure);
  return {
    timeout: `${input.searchSec}s`,
    searchMode: input.search === "first" ? "RETURN_FAST" : "CONSUME_ALL_AVAILABLE_TIME",
    considerRoadTraffic: true,
    populateTransitionPolylines: true,
    model: {
      globalStartTime: departure,
      globalEndTime: googleTime(new Date(input.departure.getTime() + 24 * 3600_000)),
      shipments: input.stops.map((stop) => ({
        label: stop.id,
        deliveries: [{ arrivalLocation: location(stop), duration: `${Math.round(input.serviceSec)}s` }],
      })),
      vehicles: [
        {
          label: "driver",
          travelMode: "DRIVING",
          startLocation: location(input.start),
          ...(input.end ? { endLocation: location(input.end) } : {}),
          // Leaves at the time asked, not whenever suits the traffic.
          startTimeWindows: [{ startTime: departure, endTime: departure }],
          costPerHour: 1,
        },
      ],
      precedenceRules: input.before.map(([first, second]) => ({
        firstIndex: first,
        firstIsDelivery: true,
        secondIndex: second,
        secondIsDelivery: true,
      })),
    },
  };
}

type GoogleRoute = {
  vehicleEndTime?: string;
  visits?: Array<{ shipmentIndex?: number; shipmentLabel?: string; startTime?: string }>;
  transitions?: Array<{
    travelDuration?: string;
    travelDistanceMeters?: number;
    trafficInfoUnavailable?: boolean;
    routePolyline?: { points?: string };
  }>;
};
type GoogleResponse = {
  routes?: GoogleRoute[];
  skippedShipments?: Array<{ index?: number; label?: string }>;
};

/** Google's answer → the route. Throws when a stop was left out. */
export function readOptimizedRoute(input: OptimizeInput, body: GoogleResponse): OptimizedRoute {
  // A zero index is left out of Google's JSON.
  const idOf = (index: number | undefined, label: string | undefined) => label ?? input.stops[index ?? 0]?.id ?? "";
  const skipped = (body.skippedShipments ?? []).map((s) => idOf(s.index, s.label));
  if (skipped.length > 0) {
    throw new OptimizationError("Google לא הצליח לשבץ חלק מהעצירות במסלול.", 422, false, skipped);
  }
  const route = body.routes?.[0] ?? {};
  const visits = route.visits ?? [];
  const transitions = route.transitions ?? [];
  // One leg before each visit, and one from the last stop to the end.
  const legCount = visits.length + (input.end ? 1 : 0);
  const legs = transitions.slice(0, legCount).map((t) => ({
    durationSec: seconds(t.travelDuration),
    distanceM: t.travelDistanceMeters ?? 0,
    polyline: t.routePolyline?.points ?? null,
    trafficUnavailable: t.trafficInfoUnavailable === true,
  }));
  if (visits.length !== input.stops.length || legs.length !== legCount) {
    throw new OptimizationError("התשובה של Google לא שלמה. נסו שוב.", 502);
  }
  const lastArrival = visits[visits.length - 1]?.startTime;
  return {
    order: visits.map((v) => idOf(v.shipmentIndex, v.shipmentLabel)),
    legs,
    arrivals: visits.map((v) => v.startTime ?? input.departure.toISOString()),
    // Ending at the last stop: the route ends once that stop is done.
    finish: input.end
      ? route.vehicleEndTime ?? input.departure.toISOString()
      : new Date(new Date(lastArrival ?? input.departure).getTime() + input.serviceSec * 1000).toISOString(),
    durationSec: legs.reduce((sum, leg) => sum + leg.durationSec, 0),
    distanceM: legs.reduce((sum, leg) => sum + leg.distanceM, 0),
  };
}

async function googleError(res: Response): Promise<OptimizationError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { status?: string; message?: string; details?: Array<{ reason?: string }> };
  } | null;
  const reasons = (body?.error?.details ?? []).map((d) => d.reason);
  // Logged for us; the person planning gets a plain sentence.
  console.error("[route-optimization] google", res.status, body?.error?.status, reasons.join(","), body?.error?.message);
  if (res.status === 403 && reasons.includes("SERVICE_DISABLED")) return new OptimizationError(NOT_ENABLED, 503, true);
  if (res.status === 403 || res.status === 401) return new OptimizationError(NO_PERMISSION, 503, true);
  if (res.status === 400) return new OptimizationError("Google לא הצליח לתכנן את המסלול הזה. בדקו את העצירות ונסו שוב.", 422);
  return new OptimizationError("תכנון המסלול לא זמין כרגע. נסו שוב בעוד רגע.", 502);
}

export async function optimizeRoute(input: OptimizeInput): Promise<OptimizedRoute> {
  const { projectId, credential } = await signIn();
  let token: string;
  try {
    token = (await credential.getAccessToken()).access_token;
  } catch (error) {
    console.error("[route-optimization] sign-in", error);
    throw new OptimizationError("ההתחברות של השרת ל-Google נכשלה (חשבון השירות של המסלולים).", 503, true);
  }
  const res = await fetch(`https://routeoptimization.googleapis.com/v1/projects/${encodeURIComponent(projectId)}:optimizeTours`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(optimizeToursBody(input)),
    cache: "no-store",
  });
  if (!res.ok) throw await googleError(res);
  return readOptimizedRoute(input, (await res.json()) as GoogleResponse);
}
