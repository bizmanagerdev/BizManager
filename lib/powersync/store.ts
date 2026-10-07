import { useSyncExternalStore } from "react";
import type { CommonPowerSyncDatabase } from "@powersync/web";
import { localDataPageFor } from "./config";

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

/** Who the open copy belongs to (LocalDataHost keeps it): for saves made on the device. */
let viewer: { id: string; role: string } | null = null;

export function setLocalViewer(next: { id: string; role: string } | null) {
  viewer = next;
}

/**
 * Where to save on the device copy first (lib/tasks/device-task-saves.ts):
 * the complete copy and whose it is — for the people whose task pages are
 * drawn from it (localDataPageFor) — else null: save on the server.
 */
export function readyDeviceSaves(): { db: CommonPowerSyncDatabase; viewerId: string } | null {
  const db = readyLocalDatabase();
  if (!db || !viewer || !localDataPageFor("tasks", viewer.role)) return null;
  return { db, viewerId: viewer.id };
}

/**
 * The open database once a complete copy is on the device, else null — for
 * code outside React (hooks read useLocalDatabase / useLocalSyncStatus).
 */
export function readyLocalDatabase(): CommonPowerSyncDatabase | null {
  return state.db && state.status?.hasSynced ? state.db : null;
}

/** readyLocalDatabase() as soon as there is one — or null after `timeoutMs`. */
export function whenLocalDatabaseReady(timeoutMs: number): Promise<CommonPowerSyncDatabase | null> {
  const now = readyLocalDatabase();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const check = () => {
      const db = readyLocalDatabase();
      if (!db) return;
      stop();
      resolve(db);
    };
    const timer = setTimeout(() => {
      stop();
      resolve(null);
    }, timeoutMs);
    const stop = () => {
      listeners.delete(check);
      clearTimeout(timer);
    };
    listeners.add(check);
  });
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
