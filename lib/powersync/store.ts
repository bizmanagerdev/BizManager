import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CommonPowerSyncDatabase } from "@powersync/web";
import { localDataPageOn, type LOCAL_DATA_PAGES } from "./config";
import type { Locale } from "@/lib/i18n/types";
import { isServerReachable, useServerReachable } from "@/lib/pwa/connection";

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

/**
 * Who the open copy belongs to (LocalDataHost keeps it): for saves made on the
 * device, and for page parts drawn from it before their page has arrived (an
 * order's page, the moment its row is tapped).
 */
export type LocalViewer = { id: string; role: string; locale: Locale; name: string | null };

let viewer: LocalViewer | null = null;
const viewerListeners = new Set<() => void>();

export function setLocalViewer(next: LocalViewer | null) {
  viewer = next;
  for (const listener of viewerListeners) listener();
}

function subscribeViewer(listener: () => void) {
  viewerListeners.add(listener);
  return () => viewerListeners.delete(listener);
}

/** The person the open copy belongs to, or null (none open here, or not yet known). */
export function useLocalViewer(): LocalViewer | null {
  return useSyncExternalStore(subscribeViewer, () => viewer, () => null);
}

/**
 * Where to save on the device copy first (lib/tasks/device-task-saves.ts):
 * the complete copy and whose it is — for the people whose task pages are
 * drawn from it (localDataPageFor) — else null: save on the server. `page`:
 * the pages that show the save — a project saved on the phone, for people
 * whose project pages are drawn from it (localDataPageOn, so the people
 * trying a page out too); the page drawn by the server would only show it
 * once it's there.
 */
export function readyDeviceSaves(
  page: keyof typeof LOCAL_DATA_PAGES = "tasks"
): { db: CommonPowerSyncDatabase; viewerId: string } | null {
  const db = readyLocalDatabase();
  if (!db || !viewer) return null;
  if (!localDataPageOn(page, viewer)) return null;
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

// Since when a complete copy has been without its sync connection (null:
// connected, or no complete copy). A copy that can't connect keeps what it had
// and misses everything since — the office computer's orders list lacked a new
// order the phone already showed (owner, 2026-10-12).
let disconnectedSince: number | null = null;

export function setLocalSyncStatus(status: LocalSyncStatus | null) {
  if (status?.hasSynced && !status.connected) disconnectedSince ??= Date.now();
  else disconnectedSince = null;
  if (status?.connected) noteSyncBlocked(false);
  if (status) watchWake();
  emit({ ...state, status });
}

// A device whose sync couldn't connect for COPY_BEHIND_AFTER_MS while online
// and on screen — an office computer behind an internet filter that blocks
// the sync service, both ways of connecting (Sentry: 49 failed connections in
// three days, 2026-10-14). Noted in memory and on the device, so its pages
// come from the server straight away, this visit and the next
// (LocalDataHost turns this into the device-pending cookie), instead of
// drawing the out-of-date copy and swapping to the server version a moment
// later — the swap read as the page jumping. Gone the moment the sync connects.
const SYNC_BLOCKED_KEY = "bizh-sync-blocked";
let syncBlocked: boolean | null = null;

function readSyncBlocked(): boolean {
  if (syncBlocked === null) {
    try {
      syncBlocked = localStorage.getItem(SYNC_BLOCKED_KEY) === "1";
    } catch {
      syncBlocked = false;
    }
  }
  return syncBlocked;
}

/** Record whether the sync is blocked; true from useLocalCopyBehind, false when it connects. */
function noteSyncBlocked(blocked: boolean): boolean {
  if (typeof window === "undefined" || readSyncBlocked() === blocked) return false;
  syncBlocked = blocked;
  try {
    if (blocked) localStorage.setItem(SYNC_BLOCKED_KEY, "1");
    else localStorage.removeItem(SYNC_BLOCKED_KEY);
  } catch {
    // Storage blocked: known for this visit only.
  }
  return true;
}

/** True while this device's sync is known not to connect (see above). */
export function useSyncBlocked(): boolean {
  return useSyncExternalStore(subscribe, readSyncBlocked, () => false);
}

/** How long the sync may be down (opening counts — it connects in a few seconds) before the copy counts as behind. */
export const COPY_BEHIND_AFTER_MS = 30_000;

/** A check that runs this much later than it was set for: the device was asleep, or the app in the background. */
const LATE_CHECK_MS = 10_000;

/**
 * Start the count again: the app came back on screen, or the device back
 * online. The time before — in the background, asleep, offline — says nothing
 * about the copy; like opening, the sync gets its few seconds to reconnect.
 * Phones counted the time in the background and went to the server version
 * the moment they were opened again (Sentry, 2026-10-12).
 */
function restartCopyBehindClock() {
  if (disconnectedSince === null) return;
  disconnectedSince = Date.now();
  emit({ ...state });
}

let wakeWatched = false;

function watchWake() {
  if (wakeWatched || typeof document === "undefined") return;
  wakeWatched = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") restartCopyBehindClock();
  });
  window.addEventListener("online", () => restartCopyBehindClock());
}

/**
 * True when the server answers, the app is on screen, and its complete copy
 * has had no sync connection for `afterMs`: the copy is out of date, and pages
 * drawn from it should show the server version instead (useLocalCard). With
 * the server not answering it stays false — then the copy is the whole point.
 * "Answering" is the server's, not the device's word (lib/pwa/connection.ts):
 * a laptop with its Wi-Fi off but another network adapter up says it's
 * online, so 30 s offline read as "the sync is blocked", and the pages it
 * opened next came from the server instead of being saved for offline
 * (owner's test, 2026-10-27). When the server answers again, the sync gets
 * its few seconds to reconnect, as when the app opens.
 */
export function useLocalCopyBehind(afterMs = COPY_BEHIND_AFTER_MS): boolean {
  const since = useSyncExternalStore(subscribe, () => disconnectedSince, () => null);
  const reachable = useServerReachable();
  const wasReachable = useRef(reachable);
  useEffect(() => {
    if (reachable && !wasReachable.current) restartCopyBehindClock();
    wasReachable.current = reachable;
  }, [reachable]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const delay = Math.max(0, since + afterMs - Date.now());
    const setFor = Date.now() + delay;
    const timer = setTimeout(() => {
      // Far later than set: asleep or in the background (and maybe no word of
      // coming back on screen) — that time doesn't count either.
      if (Date.now() - setFor > LATE_CHECK_MS) restartCopyBehindClock();
      else setNow(Date.now());
    }, delay);
    return () => clearTimeout(timer);
  }, [since, afterMs]);
  const behind =
    since !== null &&
    reachable &&
    // Off screen nothing is shown; coming back starts the count again.
    !(typeof document !== "undefined" && document.visibilityState === "hidden") &&
    now - since >= afterMs;
  useEffect(() => {
    if (behind && noteSyncBlocked(true)) emit({ ...state });
  }, [behind]);
  return behind;
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

/**
 * Wait (up to `timeoutMs`) until the saves made on the device copy have all
 * reached the server — before a save that goes straight to the server and
 * may point at one of them (a project or order for a customer just made on
 * the phone, which the server would otherwise not know yet; undoing a project
 * just made on the phone). Returns at once when nothing is waiting, or there's
 * no copy — true: nothing is waiting; false: some still are (no connection, or
 * not sent in time).
 */
export async function whenDeviceSavesSent(timeoutMs = 8000): Promise<boolean> {
  const db = readyLocalDatabase();
  if (!db) return true;
  const started = Date.now();
  for (;;) {
    const row = await db.getOptional<{ n: number }>("SELECT count(*) AS n FROM ps_crud").catch(() => null);
    if (!row || !row.n) return true;
    // No connection (the server not answering — lib/pwa/connection.ts): nothing
    // will go now — don't keep the person waiting.
    if (!isServerReachable()) return false;
    if (Date.now() - started >= timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
