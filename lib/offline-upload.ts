import { toHebrewError } from "@/lib/error-messages";
import { CONNECTION_EVENTS } from "@/lib/offline-queue";

// ── Offline file-upload queue ─────────────────────────────────────────────────
// The JSON write queue (lib/offline-queue.ts) can't hold binary, so photo/file
// uploads used to just hang or fail on a poor connection with no save — exactly
// the field-user case (photographing a check / delivery with two bars of
// signal). This engine mirrors offlineFetch's behaviour for multipart uploads,
// but parks the pending file in IndexedDB (which CAN store Blobs) and replays it
// through the same reconnect triggers. Server-side dedup (Idempotency-Key +
// withIdempotency on the upload routes) makes a replay safe.

const DB_NAME = "biz_offline_uploads";
const DB_VERSION = 1;
const QUEUE_STORE = "queue";
const FAILED_STORE = "failed";

// Uploads legitimately take longer than JSON writes (a photo over a weak link),
// so we wait longer before giving up and queueing than offlineFetch does.
const UPLOAD_TIMEOUT_MS = 30_000;
const SLOW_NOTICE_MS = 5_000;
const MAX_ATTEMPTS = 5;

function emit(name: string, detail?: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

// ── IndexedDB plumbing ────────────────────────────────────────────────────────

/** One file part of a multipart upload, stored as a Blob so IndexedDB can hold it. */
export type UploadPart = {
  fieldName: string;
  blob: Blob;
  fileName: string;
  fileType: string;
};

export type UploadEntry = {
  id: string;
  url: string;
  /** Non-file multipart fields (entity_type, entity_id, payload JSON, …). */
  fields: Record<string, string>;
  /** File parts — usually one, but order-confirm sends N delivery images. */
  parts: UploadPart[];
  label: string;
  // Shared by the live attempt and any queued replay so the server can dedupe.
  idempotencyKey: string;
  attempts: number;
  queuedAt: number;
  lastError?: string;
};

function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FAILED_STORE)) {
        db.createObjectStore(FAILED_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = run(transaction.objectStore(store));
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

async function getAll(store: string): Promise<UploadEntry[]> {
  if (!idbAvailable()) return [];
  try {
    return (await tx<UploadEntry[]>(store, "readonly", (s) => s.getAll())) ?? [];
  } catch {
    return [];
  }
}

async function put(store: string, entry: UploadEntry): Promise<void> {
  if (!idbAvailable()) return;
  try {
    await tx(store, "readwrite", (s) => s.put(entry));
    emit(CONNECTION_EVENTS.changed);
  } catch {
    // storage full / private mode — nothing more we can do
  }
}

async function del(store: string, id: string): Promise<void> {
  if (!idbAvailable()) return;
  try {
    await tx(store, "readwrite", (s) => s.delete(id));
    emit(CONNECTION_EVENTS.changed);
  } catch {}
}

async function clearStore(store: string): Promise<void> {
  if (!idbAvailable()) return;
  try {
    await tx(store, "readwrite", (s) => s.clear());
    emit(CONNECTION_EVENTS.changed);
  } catch {}
}

// ── Public queue helpers ──────────────────────────────────────────────────────

export async function getUploadQueueLength(): Promise<number> {
  return (await getAll(QUEUE_STORE)).length;
}

export async function getUploadFailedLength(): Promise<number> {
  return (await getAll(FAILED_STORE)).length;
}

/** The pending upload entries (for the pending-sync panel — includes the blobs). */
export async function getUploadQueue(): Promise<UploadEntry[]> {
  return getAll(QUEUE_STORE);
}

/** The parked failed upload entries (label + lastError + blobs for a thumbnail). */
export async function getUploadFailed(): Promise<UploadEntry[]> {
  return getAll(FAILED_STORE);
}

export async function clearFailedUploads(): Promise<void> {
  await clearStore(FAILED_STORE);
}

/** Move every parked failed upload back into the live queue for another attempt. */
export async function retryFailedUploads(): Promise<void> {
  const failed = await getAll(FAILED_STORE);
  for (const entry of failed) {
    await put(QUEUE_STORE, { ...entry, attempts: 0, lastError: undefined });
    await del(FAILED_STORE, entry.id);
  }
}

/** Move a SINGLE parked failed upload back into the live queue (per-item retry). */
export async function retryFailedUpload(id: string): Promise<void> {
  const failed = await getAll(FAILED_STORE);
  const entry = failed.find((e) => e.id === id);
  if (!entry) return;
  await put(QUEUE_STORE, { ...entry, attempts: 0, lastError: undefined });
  await del(FAILED_STORE, id);
}

/** Discard a SINGLE parked failed upload (per-item dismiss). */
export async function removeFailedUpload(id: string): Promise<void> {
  await del(FAILED_STORE, id);
}

async function enqueueUpload(
  entry: Omit<UploadEntry, "id" | "queuedAt" | "attempts">
): Promise<void> {
  await put(QUEUE_STORE, {
    ...entry,
    id: crypto.randomUUID(),
    queuedAt: Date.now(),
    attempts: 0,
  });
}

async function failUpload(entry: UploadEntry, lastError: string): Promise<void> {
  await del(QUEUE_STORE, entry.id);
  await put(FAILED_STORE, { ...entry, lastError });
}

// ── Smart upload ──────────────────────────────────────────────────────────────

export type OfflineUploadResult =
  | { queued: true; reason: "offline" | "slow" }
  | { queued: false; ok: true; data: unknown }
  | { queued: false; ok: false; status: number; error: string };

export type OfflineUploadFile = { fieldName: string; file: File };

export type OfflineUploadInput = {
  /** Non-file multipart fields (e.g. entity_id, or the order-confirm payload JSON). */
  fields?: Record<string, string>;
  /** Shorthand: a single file under `fileFieldName`. */
  file?: File;
  /** Multipart field name for the shorthand `file`. Default "file". */
  fileFieldName?: string;
  /** Explicit file parts — several files, and/or a non-default field name (e.g. delivery_images). */
  files?: OfflineUploadFile[];
  /** Human label for connection toasts (e.g. "תמונת הצ׳ק"). */
  label: string;
};

function toParts(input: OfflineUploadInput): UploadPart[] {
  const list: OfflineUploadFile[] = [
    ...(input.file ? [{ fieldName: input.fileFieldName ?? "file", file: input.file }] : []),
    ...(input.files ?? []),
  ];
  return list.map(({ fieldName, file }, i) => ({
    fieldName,
    blob: file,
    fileName: file.name || `upload-${Date.now()}-${i}`,
    fileType: file.type || "application/octet-stream",
  }));
}

function buildForm(fields: Record<string, string>, parts: UploadPart[]): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const part of parts) {
    form.append(part.fieldName, new File([part.blob], part.fileName, { type: part.fileType }), part.fileName);
  }
  return form;
}

async function extractError(response: Response): Promise<string> {
  const text = await response.text().catch(() => response.statusText);
  let error = text;
  try {
    const json = JSON.parse(text) as { error?: string };
    if (json.error) error = json.error;
  } catch {}
  return toHebrewError(error);
}

/**
 * Submit a multipart file upload with offline/poor-connection resilience:
 *  - Definitely offline  → queue the file in IndexedDB, tell the caller.
 *  - Online but too slow  → after a timeout, abort and queue it (a replay is
 *    safe because of the shared idempotency key), so the UI never hangs.
 *  - Online network error → queue it (same safety) instead of losing the file.
 *  - Server reached, responded → return ok / error as normal (a real validation
 *    error is NOT queued; the user must fix it).
 *
 * The target route MUST be wrapped in withIdempotency for a queued replay to be
 * duplicate-safe.
 */
export async function offlineUpload(
  url: string,
  input: OfflineUploadInput
): Promise<OfflineUploadResult> {
  const { fields = {}, label } = input;
  const parts = toParts(input);
  const idempotencyKey = crypto.randomUUID();

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    await enqueueUpload({ url, fields, parts, label, idempotencyKey });
    emit(CONNECTION_EVENTS.queued, { label, reason: "offline" });
    return { queued: true, reason: "offline" };
  }

  const controller = new AbortController();
  const slowTimer = setTimeout(() => emit(CONNECTION_EVENTS.slow, { label }), SLOW_NOTICE_MS);
  const timeoutTimer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: buildForm(fields, parts),
      signal: controller.signal,
    });
    clearTimeout(slowTimer);
    clearTimeout(timeoutTimer);

    if (!response.ok) {
      return { queued: false, ok: false, status: response.status, error: await extractError(response) };
    }
    const data = await response.json().catch(() => null);
    return { queued: false, ok: true, data };
  } catch {
    // Aborted by our timeout, or a network error while still nominally "online"
    // (the classic flaky case). Queue it — the idempotency key stops a replay
    // from creating a duplicate even if the request reached the server.
    clearTimeout(slowTimer);
    clearTimeout(timeoutTimer);
    await enqueueUpload({ url, fields, parts, label, idempotencyKey });
    emit(CONNECTION_EVENTS.queued, { label, reason: "slow" });
    return { queued: true, reason: "slow" };
  }
}

// ── Queue processor ───────────────────────────────────────────────────────────

export type ProcessResult = { processed: number; failed: number; remaining: number };

/** Treat 4xx (except 408/429) as permanent — retrying won't help. */
function isPermanentFailure(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

let processing = false;

export async function processUploadQueue(): Promise<ProcessResult> {
  // A file upload can outlive one processing pass; guard against a second
  // trigger (online event + SW message) running the same entry twice.
  if (processing) return { processed: 0, failed: 0, remaining: await getUploadQueueLength() };
  processing = true;

  let processed = 0;
  let failed = 0;

  try {
    for (;;) {
      if (typeof navigator !== "undefined" && !navigator.onLine) break;
      const queue = await getAll(QUEUE_STORE);
      const entry = queue[0];
      if (!entry) break;

      try {
        const response = await fetch(entry.url, {
          method: "POST",
          headers: { "Idempotency-Key": entry.idempotencyKey },
          body: buildForm(entry.fields, entry.parts),
        });

        if (response.ok) {
          await del(QUEUE_STORE, entry.id);
          processed++;
          continue;
        }

        const hebrewError = await extractError(response);
        if (isPermanentFailure(response.status)) {
          await failUpload(entry, hebrewError);
          failed++;
          continue;
        }

        // Transient server error (5xx/408/429) — bump attempts, park if exhausted.
        const attempts = entry.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await failUpload(entry, hebrewError);
          failed++;
        } else {
          await put(QUEUE_STORE, { ...entry, attempts });
          // Stop this pass; a later trigger retries so we don't hammer the server.
          break;
        }
      } catch {
        // Connectivity dropped again mid-upload — stop without counting an
        // attempt (not the request's fault) and retry on the next trigger.
        break;
      }
    }
  } finally {
    processing = false;
  }

  if (processed > 0) emit(CONNECTION_EVENTS.synced, { count: processed });
  if (failed > 0) emit(CONNECTION_EVENTS.failed, { count: failed });

  return { processed, failed, remaining: await getUploadQueueLength() };
}
