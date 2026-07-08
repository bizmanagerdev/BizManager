// ── Offline read cache ────────────────────────────────────────────────────────
// A tiny IndexedDB key→snapshot store for READ data, so core lookups keep working
// with no signal. Whenever a dataset loads online we persist a snapshot; when the
// network is unreachable we hydrate the last snapshot (marked stale, with the time
// it was captured) instead of showing nothing. This is the read-side companion to
// the offline write/upload queues.

const DB_NAME = "biz_offline_reads";
const DB_VERSION = 1;
const STORE = "snapshots";

type SnapshotRow<T> = { key: string; data: T; savedAt: number };

export type Snapshot<T> = { data: T; savedAt: number };

function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        transaction.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      })
  );
}

/** Persist the latest online copy of a dataset under `key`. Best-effort. */
export async function saveSnapshot<T>(key: string, data: T): Promise<void> {
  if (!idbAvailable()) return;
  try {
    const row: SnapshotRow<T> = { key, data, savedAt: Date.now() };
    await tx("readwrite", (s) => s.put(row));
  } catch {
    // storage full / private mode — offline reads simply won't be available
  }
}

/** Load the last persisted snapshot for `key`, or null if none/unavailable. */
export async function loadSnapshot<T>(key: string): Promise<Snapshot<T> | null> {
  if (!idbAvailable()) return null;
  try {
    const row = (await tx("readonly", (s) => s.get(key))) as SnapshotRow<T> | undefined;
    if (!row) return null;
    return { data: row.data, savedAt: row.savedAt };
  } catch {
    return null;
  }
}
