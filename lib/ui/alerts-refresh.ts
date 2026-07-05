"use client";

import { useSyncExternalStore } from "react";
import { refreshNavCounts } from "@/lib/ui/nav-counts-store";

// A tiny "alerts changed" signal. Bumping it makes every subscribed alert
// surface (page bars, sidebar badges) refetch — used right after a resync so a
// just-fixed problem's alert clears on screen immediately.

let version = 0;
const listeners = new Set<() => void>();

export function useAlertsVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => version,
  );
}

/** Refresh every on-screen alert surface (page bars + sidebar badges) now — no
 * server sync. Call after something already re-synced (e.g. the manual button). */
export function notifyAlertsChanged(): void {
  version += 1;
  for (const l of listeners) l();
  refreshNavCounts();
}

/**
 * Run the system-reminder sync now (so a just-fixed problem auto-resolves
 * instead of waiting for the cron), then refresh the on-screen alert surfaces.
 * Best-effort + fire-and-forget friendly: `void resyncAlerts()` after a save.
 */
export async function resyncAlerts(): Promise<void> {
  try {
    await fetch("/api/reminders/sync-now", { method: "POST" });
  } catch {
    // best-effort — the cron catches up regardless
  }
  notifyAlertsChanged();
}
