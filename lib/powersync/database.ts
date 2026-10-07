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
import { POWERSYNC_ASSETS_BASE } from "./config";
import { AppSchema } from "./schema";
import { setLocalDatabase, setLocalSyncStatus, type LocalSyncStatus } from "./store";

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
// 5 seconds while it lasts); everything at info and up as a breadcrumb.
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
  withSentry((Sentry) =>
    Sentry.captureException(error instanceof Error ? error : new Error(`${message}: ${describeError(error)}`), {
      tags: { area: "powersync" },
      fingerprint: ["powersync", message],
    })
  );
}

const logger: PowerSyncLogger = {
  log({ level, message, error }) {
    if (level >= LogLevels.error) report(message, error);
    else if (level >= LogLevels.info) withSentry((Sentry) => Sentry.addBreadcrumb({ category: "powersync", message }));
  },
};

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

    const stopListening = db.registerListener({
      statusChanged: (status) => {
        setLocalSyncStatus(toLocalStatus(status));
        if (status.downloadError) report("Sync download error", status.downloadError);
      },
    });
    setLocalSyncStatus(toLocalStatus(db.currentStatus));

    // Connect once for the session. connect() reports trouble through the
    // status and the logger, and keeps retrying on its own (every 5 s) —
    // including after the phone drops its connection in the background.
    void db.connect(new BizConnector(), {
      connectionMethod: SyncStreamConnectionMethod.WEB_SOCKET,
      appMetadata: { build: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" },
    });

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
