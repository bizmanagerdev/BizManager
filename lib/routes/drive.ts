// Driving a planned route stop by stop (owner, 2026-10-27): Waze takes the
// driver to a stop, the driver comes back to BizH to confirm the delivery, and
// one tap sends Waze on to the next stop. Waze only: "my users are not
// interested in Google Maps". The drive is kept on the phone, so coming back
// from Waze lands on the same stop.

import type { StructuredAddress } from "@/lib/address/structured";
import type { RoutePoint } from "@/lib/routes/plan";
import type { PlannerStop } from "@/lib/routes/planner-stops";

/** Where the drive is kept on the phone, and the event the planner fires when it changes. */
export const DRIVE_STORAGE_KEY = "bizh.routeDrive.v1";
export const DRIVE_CHANGED_EVENT = "bizh:route-drive";

export type DriveStop = Pick<
  PlannerStop,
  "key" | "kind" | "name" | "phone" | "city" | "address" | "orderIds" | "collectOnDelivery" | "note"
> & {
  lat: number;
  lng: number;
  /** When the plan expected the driver there. */
  arrival: string | null;
};

/** What happened at a stop: its delivery confirmed, not delivered, or an added stop done. */
export type StopOutcome = "delivered" | "skipped" | "done";

export type Drive = {
  /** The day it started, on Israel's calendar: a drive from another day isn't brought back. */
  day: string;
  stops: DriveStop[];
  /** Where the route ends after the last stop; null when it ends at the last stop. */
  end: { point: RoutePoint; label: string } | null;
  /** The end as an address, for "שינוי המסלול": a route changed on the road still ends there, not where the driver is. */
  endPlace?: StructuredAddress | null;
  /** The stop the driver is on; stops.length once every stop is behind them. */
  at: number;
  outcome: Record<string, StopOutcome>;
  /** The orders whose delivery was confirmed on this drive. */
  confirmed: string[];
};

/** The next stop with nothing done yet: after the current one, else an earlier one jumped over; stops.length when none is left. */
export function nextOpen(drive: Pick<Drive, "stops" | "outcome">, from: number): number {
  const open = (index: number) => !drive.outcome[drive.stops[index].key];
  for (let index = from + 1; index < drive.stops.length; index++) if (open(index)) return index;
  for (let index = 0; index <= Math.min(from, drive.stops.length - 1); index++) if (index !== from && open(index)) return index;
  return drive.stops.length;
}

/** The current stop finished as `outcome`, and the drive moved on to the next open stop. */
export function finishStop(drive: Drive, outcome: StopOutcome): Drive {
  const stop = drive.stops[drive.at];
  if (!stop) return drive;
  const next = { ...drive, outcome: { ...drive.outcome, [stop.key]: outcome } };
  return { ...next, at: nextOpen(next, drive.at) };
}

/** A drive kept on the phone, if it's today's and whole; null otherwise. */
export function parseDrive(json: string | null, today: string): Drive | null {
  if (!json) return null;
  try {
    const drive = JSON.parse(json) as Partial<Drive> | null;
    if (!drive || drive.day !== today || !Array.isArray(drive.stops) || drive.stops.length === 0) return null;
    const at = typeof drive.at === "number" && drive.at >= 0 && drive.at <= drive.stops.length ? drive.at : 0;
    return {
      day: drive.day,
      stops: drive.stops,
      end: drive.end ?? null,
      ...(drive.endPlace ? { endPlace: drive.endPlace } : {}),
      at,
      outcome: drive.outcome && typeof drive.outcome === "object" ? drive.outcome : {},
      confirmed: Array.isArray(drive.confirmed) ? drive.confirmed : [],
    };
  } catch {
    return null;
  }
}
