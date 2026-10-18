import {
  LogLevels,
  PowerSyncDatabase,
  SyncStreamConnectionMethod,
  WASQLiteVFS,
  type CommonPowerSyncDatabase,
  type PowerSyncLogger,
  type SyncStatus,
} from "@powersync/web";
import { withSentry } from "@/lib/sentry-lazy";
import { BizConnector } from "./connector";
import { isConnectionDrop } from "./connection-drop";
import { POWERSYNC_ASSETS_BASE } from "./config";
import { AppSchema } from "./schema";
import { setLocalDatabase, setLocalSyncStatus, type LocalSyncStatus } from "./store";
import {
  createTransportWatch,
  storedTransport,
  watchStoredTransport,
  type SyncTransport,
  type TransportWatch,
} from "./sync-transport";

// Opens, connects and closes the on-device database. Browser only — loaded
// through LocalDataHost (dynamic import, ssr: false), never on the server.
//
// One database file per person (`bizh-<login id>.db`), so two people on one
// device never see each other's copy. Logout wipes it (wipeAndClose).

const WORKER_URL = `${POWERSYNC_ASSETS_BASE}/worker.js`;

// Storage engine, chosen once per device and remembered: switching later means
// a new, empty database. OPFS (the browser's fast file storage) where it works
// — Chrome, Android WebView, Safari 17.2+ — else IndexedDB (private browsing,
// older Safari). If OPFS fails to open, this device falls back for good.
const VFS_KEY = "bizh-powersync-vfs";

function readStoredVfs(): WASQLiteVFS | null {
  try {
    const value = localStorage.getItem(VFS_KEY);
    return value === WASQLiteVFS.OPFSCoopSyncVFS || value === WASQLiteVFS.IDBBatchAtomicVFS ? value : null;
  } catch {
    return null;
  }
}

function storeVfs(vfs: WASQLiteVFS) {
  try {
    localStorage.setItem(VFS_KEY, vfs);
  } catch {
    // Storage blocked: decided again next time.
  }
}

async function chooseVfs(): Promise<WASQLiteVFS> {
  const stored = readStoredVfs();
  if (stored) return stored;
  let opfs = false;
  try {
    opfs = typeof navigator.storage?.getDirectory === "function" && Boolean(await navigator.storage.getDirectory());
  } catch {
    opfs = false; // e.g. private browsing
  }
  const vfs = opfs ? WASQLiteVFS.OPFSCoopSyncVFS : WASQLiteVFS.IDBBatchAtomicVFS;
  storeVfs(vfs);
  return vfs;
}

// Errors to Sentry, each kind once per page load ("Sync error" repeats every
// 5 seconds while it lasts), a dropped connection as a warning
// (connection-drop.ts); everything at info and up as a breadcrumb.
const reported = new Set<string>();

/** What went wrong, readably — errors from the sync worker arrive as plain objects, not Errors. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === "string") return message;
  try {
    return (JSON.stringify(error) ?? String(error ?? "")).slice(0, 300);
  } catch {
    return String(error);
  }
}

function report(message: string, error: unknown) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return; // offline isn't a bug
  if (reported.has(message)) return;
  reported.add(message);
  const description = describeError(error);
  withSentry((Sentry) =>
    Sentry.captureException(error instanceof Error ? error : new Error(`${message}: ${description}`), {
      level: isConnectionDrop(message, description) ? "warning" : "error",
      tags: { area: "powersync" },
      fingerprint: ["powersync", message],
    })
  );
}

// The open copy's way of connecting (sync-transport.ts) — told of every failed
// connection, from the log and from the status.
let transportWatch: TransportWatch | null = null;

const logger: PowerSyncLogger = {
  log({ level, message, error }) {
    if (level >= LogLevels.error) {
      report(message, error);
      if (isConnectionDrop(message, describeError(error))) transportWatch?.failed();
    } else if (level >= LogLevels.info) withSentry((Sentry) => Sentry.addBreadcrumb({ category: "powersync", message }));
  },
};

/**
 * May this tab decide how the device connects? Only one on screen, in front
 * and online: every tab shares the one connection (sync-transport.ts), and a
 * failure while asleep, offline or in the background says nothing about the
 * way of connecting.
 */
function tabMayDecide(): boolean {
  return (
    document.visibilityState === "visible" &&
    (typeof document.hasFocus !== "function" || document.hasFocus()) &&
    navigator.onLine !== false
  );
}

/** A tick this late means the device was asleep. */
const WAKE_GAP_MS = 20_000;

/**
 * Start the failure count over whenever the device was away — back on screen,
 * back online, or awake after a sleep (a tick far later than set) — and take
 * the way another tab switched to. Returns a stop function.
 */
function followTransport(watch: TransportWatch): () => void {
  const reset = () => watch.reset();
  const onVisible = () => {
    if (document.visibilityState === "visible") reset();
  };
  let lastTick = Date.now();
  const tick = window.setInterval(() => {
    const now = Date.now();
    if (now - lastTick > WAKE_GAP_MS) reset();
    lastTick = now;
  }, 5000);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", reset);
  const stopFollowing = watchStoredTransport((next) => watch.adopt(next));
  return () => {
    window.clearInterval(tick);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", reset);
    stopFollowing();
  };
}

function connectOptions(transport: SyncTransport) {
  return {
    connectionMethod: transport === "http" ? SyncStreamConnectionMethod.HTTP : SyncStreamConnectionMethod.WEB_SOCKET,
    appMetadata: { build: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" },
  };
}

function toLocalStatus(status: SyncStatus): LocalSyncStatus {
  const error = status.downloadError ?? status.uploadError;
  return {
    connected: status.connected,
    connecting: status.connecting,
    hasSynced: status.hasSynced === true,
    lastSyncedAt: status.lastSyncedAt ?? null,
    downloading: status.downloading,
    uploading: status.uploading,
    error: error ? error.message : null,
  };
}

type Open = { authUid: string; db: CommonPowerSyncDatabase; stopListening: () => void };
let current: Open | null = null;
let opening: Promise<CommonPowerSyncDatabase> | null = null;

async function create(authUid: string, vfs: WASQLiteVFS): Promise<CommonPowerSyncDatabase> {
  const db = new PowerSyncDatabase({
    schema: AppSchema,
    database: { dbFilename: `bizh-${authUid}.db`, vfs, worker: WORKER_URL },
    sync: { worker: WORKER_URL },
    logger,
  });
  await db.init();
  return db;
}

/** Open (or return the already-open) database for this person and start syncing. */
export async function openLocalDatabase(authUid: string): Promise<CommonPowerSyncDatabase> {
  if (current?.authUid === authUid) return current.db;
  if (opening) return opening;
  opening = (async () => {
    // Someone else signed in on this device: the previous person's copy goes.
    if (current) await closeLocalDatabase({ wipe: true });

    let vfs = await chooseVfs();
    let db: CommonPowerSyncDatabase;
    try {
      db = await create(authUid, vfs);
    } catch (error) {
      if (vfs !== WASQLiteVFS.OPFSCoopSyncVFS) throw error;
      report("OPFS database failed to open — falling back to IndexedDB", error);
      vfs = WASQLiteVFS.IDBBatchAtomicVFS;
      storeVfs(vfs);
      db = await create(authUid, vfs);
    }

    // Ask the browser not to evict the copy under storage pressure.
    void navigator.storage?.persist?.().catch(() => {});

    // The WebSocket, unless this device found it doesn't work here; a few
    // failed connections in a row — in the tab on screen — switch to the
    // other way, and every tab follows (sync-transport.ts).
    const connector = new BizConnector();
    const watch = createTransportWatch(
      storedTransport(),
      (next) => {
        withSentry((Sentry) =>
          Sentry.captureMessage(`PowerSync: switched the sync to ${next === "http" ? "HTTP streaming" : "the WebSocket"}`, {
            level: "info",
            tags: { area: "powersync" },
            fingerprint: ["powersync", "transport-switch", next],
          })
        );
        // A second connect() replaces the running one.
        void db.connect(connector, connectOptions(next));
      },
      tabMayDecide
    );
    transportWatch = watch;
    const stopFollowing = followTransport(watch);

    const unregister = db.registerListener({
      statusChanged: (status) => {
        setLocalSyncStatus(toLocalStatus(status));
        if (status.connected) watch.connected();
        if (status.downloadError) {
          report("Sync download error", status.downloadError);
          if (!status.connected) watch.failed();
        }
      },
    });
    const stopListening = () => {
      unregister();
      stopFollowing();
    };
    setLocalSyncStatus(toLocalStatus(db.currentStatus));

    // Connect once for the session. connect() reports trouble through the
    // status and the logger, and keeps retrying on its own (every 5 s) —
    // including after the phone drops its connection in the background.
    void db.connect(connector, connectOptions(watch.transport));

    current = { authUid, db, stopListening };
    setLocalDatabase(db);
    return db;
  })();
  try {
    return await opening;
  } finally {
    opening = null;
  }
}

/**
 * Stop syncing and close. `wipe: true` (logout, or someone else signs in)
 * deletes this person's synced data from the device first.
 */
export async function closeLocalDatabase({ wipe }: { wipe: boolean }): Promise<void> {
  const open = current;
  if (!open) return;
  current = null;
  transportWatch = null;
  setLocalDatabase(null);
  open.stopListening();
  try {
    // Both fields always: an options object without clearLocal means false.
    if (wipe) await open.db.disconnectAndClear({ clearLocal: true, soft: false });
    else await open.db.disconnect();
  } finally {
    await open.db.close();
  }
}
