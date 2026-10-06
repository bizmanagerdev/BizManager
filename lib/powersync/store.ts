import { useSyncExternalStore } from "react";
import type { CommonPowerSyncDatabase } from "@powersync/web";

// The open on-device database and its sync status, for any component to read.
// Deliberately free of PowerSync runtime imports: pages and the top bar read
// this without pulling the SDK into their bundles — the SDK loads only inside
// LocalDataHost, for the people the copy is switched on for.

export type LocalSyncStatus = {
  connected: boolean;
  connecting: boolean;
  /** Has a complete copy been downloaded at least once (survives restarts). */
  hasSynced: boolean;
  lastSyncedAt: Date | null;
  downloading: boolean;
  uploading: boolean;
  /** Last download/upload error message, while it lasts. */
  error: string | null;
};

type State = { db: CommonPowerSyncDatabase | null; status: LocalSyncStatus | null };

let state: State = { db: null, status: null };
const listeners = new Set<() => void>();
let wipe: (() => Promise<void>) | null = null;

function emit(next: State) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLocalDatabase(db: CommonPowerSyncDatabase | null) {
  if (state.db === db) return;
  emit({ db, status: db ? state.status : null });
}

export function setLocalSyncStatus(status: LocalSyncStatus | null) {
  emit({ ...state, status });
}

/** The open database, or null (not switched on for this person, or still opening). */
export function useLocalDatabase(): CommonPowerSyncDatabase | null {
  return useSyncExternalStore(subscribe, () => state.db, () => null);
}

export function useLocalSyncStatus(): LocalSyncStatus | null {
  return useSyncExternalStore(subscribe, () => state.status, () => null);
}

/** LocalDataHost registers how to wipe the device copy (logout). */
export function registerLocalDataWipe(fn: (() => Promise<void>) | null) {
  wipe = fn;
}

/**
 * Logout: remove this person's data from the device before the session ends.
 * Never blocks logout for long — gives up after `timeoutMs`.
 */
export async function wipeLocalDataBeforeLogout(timeoutMs = 3000): Promise<void> {
  if (!wipe) return;
  const run = wipe;
  await Promise.race([run().catch(() => {}), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}
