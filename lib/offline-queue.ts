import { toHebrewError } from "@/lib/error-messages";

const QUEUE_KEY = "biz_offline_queue";
const FAILED_KEY = "biz_offline_failed";
// What a queued save's replay answered (by its idempotency key) — the new
// row's id, for the saves that wait on it (files, contacts — see `after`).
const RESULTS_KEY = "biz_offline_results";
const RESULT_KEEP_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_RESULTS = 200;
const DRAFT_PREFIX = "biz_draft:";

// How long a single online write may run before we stop waiting, assume the
// connection is too poor to finish, and fall back to the offline queue. Without
// this the request can hang for minutes on a flaky network (the old behaviour
// the user hit: "stuck mid-task", then a late error with the data lost).
const REQUEST_TIMEOUT_MS = 12_000;
// When a write is still in flight after this long, warn the user it's slow so
// they know it isn't frozen — even before we decide to queue it.
const SLOW_NOTICE_MS = 4_000;
// A queued action is retried at most this many times before it is parked in the
// "failed" bucket and surfaced to the user for review (instead of looping
// forever and silently re-trying a permanently-broken request).
const MAX_ATTEMPTS = 5;

// ── Connection events ─────────────────────────────────────────────────────────
// Decoupled signalling so the engine can stay UI-agnostic. A single global
// component (ConnectionToasts) listens and turns these into toasts; the status
// hook listens to keep its counts fresh in the same tab.

export const CONNECTION_EVENTS = {
  slow: "biz:conn-slow",       // a write is taking too long (still trying)
  queued: "biz:conn-queued",   // a write was saved locally to send later
  synced: "biz:conn-synced",   // queued actions were successfully sent
  failed: "biz:conn-failed",   // queued actions permanently failed
  settled: "biz:conn-settled", // a write that was slow got its answer (or was given up on)
  changed: "biz:queue-changed", // queue/failed counts changed (same-tab refresh)
} as const;

function emit(name: string, detail?: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * The "connection is slow" notice for one write: `slow` once it has taken
 * `afterMs`, and `settled` when it ends — answered, refused or given up on —
 * if the notice went out. Returns the ending. The notice is a loading toast,
 * which never times out on its own: without `settled`, a slow save that then
 * went through left "שומר..." on screen for good.
 */
export function slowNotice(label: string | undefined, afterMs: number = SLOW_NOTICE_MS): () => void {
  let shown = false;
  const timer = setTimeout(() => {
    shown = true;
    emit(CONNECTION_EVENTS.slow, { label });
  }, afterMs);
  return () => {
    clearTimeout(timer);
    if (!shown) return;
    shown = false;
    emit(CONNECTION_EVENTS.settled, { label });
  };
}

// ── Draft helpers ─────────────────────────────────────────────────────────────

export function saveDraft(key: string, data: unknown): void {
  try {
    localStorage.setItem(`${DRAFT_PREFIX}${key}`, JSON.stringify(data));
  } catch {
    // storage quota or private-mode restriction — ignore silently
  }
}

export function loadDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${DRAFT_PREFIX}${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(`${DRAFT_PREFIX}${key}`);
  } catch {}
}

// ── Queue helpers ─────────────────────────────────────────────────────────────

export type QueueEntry = {
  id: string;
  url: string;
  body: Record<string, unknown>;
  label: string;
  queuedAt: number;
  attempts: number;
  // Sent as the Idempotency-Key header so the server can dedupe a replay against
  // a request that actually reached it but whose response we never received.
  idempotencyKey?: string;
  // Last error surfaced when the entry was parked as failed.
  lastError?: string;
  // Sent only once the queued save with this key has gone out: its answer's
  // `idPath` (e.g. "customer.id") fills every "{id}" in the body. A follow-up
  // of a create that waited for the connection (a new customer's contacts).
  after?: QueueAfter;
};

/** A queued save that waits for another one (by its idempotency key) and uses the id it was given. */
export type QueueAfter = { key: string; idPath: string };

/** The id a queued save was given, once its replay has gone out — else null. */
export function queuedResultId(key: string, idPath: string): string | null {
  const entry = readResults()[key];
  if (!entry) return null;
  let value: unknown = entry.data;
  for (const part of idPath.split(".")) {
    value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
  }
  return typeof value === "string" && value ? value : null;
}

/** Did the queued save with this key fail for good (parked)? Then what waits on it can't go. */
export function queuedKeyFailed(key: string): boolean {
  return readFailed().some((entry) => entry.idempotencyKey === key);
}

/** Every "{id}" in a body (at any depth) replaced by the id. */
function withId<T>(value: T, id: string): T {
  if (value === "{id}") return id as T;
  if (Array.isArray(value)) return value.map((item) => withId(item, id)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withId(v, id)])) as T;
  }
  return value;
}

function readResults(): Record<string, { data: unknown; at: number }> {
  try {
    const raw = localStorage.getItem(RESULTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, { data: unknown; at: number }>) : {};
  } catch {
    return {};
  }
}

function rememberResult(key: string, data: unknown): void {
  try {
    const now = Date.now();
    const kept = Object.entries(readResults())
      .filter(([, entry]) => now - entry.at < RESULT_KEEP_MS)
      .slice(-(MAX_RESULTS - 1));
    localStorage.setItem(RESULTS_KEY, JSON.stringify(Object.fromEntries([...kept, [key, { data, at: now }]])));
  } catch {}
}

/**
 * Queue a save that has to wait for another queued one — it goes out right
 * after, with the id that one was given (every "{id}" in `body`). For the
 * follow-ups of a create that waited for the connection.
 */
export function enqueueAfter(after: QueueAfter, entry: { url: string; body: Record<string, unknown>; label: string }): void {
  enqueue({ ...entry, idempotencyKey: crypto.randomUUID(), after });
}

function readQueue(): QueueEntry[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueueEntry[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueueEntry[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {}
  emit(CONNECTION_EVENTS.changed);
}

function readFailed(): QueueEntry[] {
  try {
    const raw = localStorage.getItem(FAILED_KEY);
    return raw ? (JSON.parse(raw) as QueueEntry[]) : [];
  } catch {
    return [];
  }
}

function writeFailed(entries: QueueEntry[]): void {
  try {
    localStorage.setItem(FAILED_KEY, JSON.stringify(entries));
  } catch {}
  emit(CONNECTION_EVENTS.changed);
}

/**
 * Writes this page is sending right now. One with an idempotency key is kept
 * on the device BEFORE it goes out (see offlineFetch), so it sits in the queue
 * meanwhile — but it isn't waiting: the counts and the pending panel leave it
 * out, and the replay skips it. If the app is closed or reloaded mid-send this
 * is empty next time, and the entry is sent like any other.
 */
const sending = new Set<string>();

function waiting(): QueueEntry[] {
  return readQueue().filter((entry) => !sending.has(entry.id));
}

export function getQueue(): QueueEntry[] {
  return waiting();
}

export function getQueueLength(): number {
  return waiting().length;
}

export function getFailed(): QueueEntry[] {
  return readFailed();
}

export function getFailedLength(): number {
  return readFailed().length;
}

export function clearFailed(): void {
  writeFailed([]);
}

/** Move every parked failed entry back into the live queue for another attempt. */
export function retryFailed(): void {
  const failed = readFailed().map((e) => ({ ...e, attempts: 0, lastError: undefined }));
  if (failed.length === 0) return;
  writeQueue([...readQueue(), ...failed]);
  writeFailed([]);
}

/** Move a SINGLE parked failed entry back into the live queue (per-item retry). */
export function retryFailedEntry(id: string): void {
  const failed = readFailed();
  const entry = failed.find((e) => e.id === id);
  if (!entry) return;
  writeQueue([...readQueue(), { ...entry, attempts: 0, lastError: undefined }]);
  writeFailed(failed.filter((e) => e.id !== id));
}

/** Discard a SINGLE parked failed entry (per-item dismiss). */
export function removeFailed(id: string): void {
  writeFailed(readFailed().filter((e) => e.id !== id));
}

export function enqueue(
  entry: Omit<QueueEntry, "id" | "queuedAt" | "attempts">,
  { sending: beingSent = false }: { sending?: boolean } = {}
): QueueEntry {
  const full: QueueEntry = {
    ...entry,
    id: crypto.randomUUID(),
    queuedAt: Date.now(),
    attempts: 0,
  };
  // Marked before it's written, so nothing counts it as waiting in between.
  if (beingSent) sending.add(full.id);
  writeQueue([...readQueue(), full]);
  return full;
}

export function dequeue(id: string): void {
  writeQueue(readQueue().filter((e) => e.id !== id));
}

function failEntry(entry: QueueEntry, lastError: string): void {
  writeQueue(readQueue().filter((e) => e.id !== entry.id));
  writeFailed([...readFailed(), { ...entry, lastError }]);
}

// ── Smart fetch ───────────────────────────────────────────────────────────────

export type OfflineFetchResult =
  /** `key`: the queued save's idempotency key (an `idempotent` save) — what a follow-up waits on (QueueAfter). */
  | { queued: true; reason: "offline" | "slow"; key?: string }
  | { queued: false; ok: true; data: unknown }
  | { queued: false; ok: false; status: number; error: string };

export type OfflineFetchOptions = {
  /**
   * Mark this as an insert ("create") so we attach an Idempotency-Key. With the
   * key the server can safely ignore a replay of a request it already processed,
   * which is what makes queue-on-failure safe for create endpoints.
   */
  idempotent?: boolean;
};

function buildHeaders(idempotencyKey?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return headers;
}

/**
 * Submit a JSON write with offline/poor-connection resilience:
 *  - Definitely offline  → queue immediately, tell the caller it's queued.
 *  - Online but too slow  → after a timeout, abort and queue it (a replay is
 *    safe because of the idempotency key), so the UI never hangs.
 *  - Online network error → queue it (same safety), instead of losing the data.
 *  - Server reached, responded → return ok / error as normal (do NOT queue a
 *    real validation error; the user must fix it).
 */
export async function offlineFetch(
  url: string,
  body: Record<string, unknown>,
  label: string,
  options: OfflineFetchOptions = {}
): Promise<OfflineFetchResult> {
  // Generate the key up-front so the live attempt and any queued replay share it.
  const idempotencyKey = options.idempotent ? crypto.randomUUID() : undefined;

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    enqueue({ url, body, label, idempotencyKey });
    emit(CONNECTION_EVENTS.queued, { label, reason: "offline" });
    return { queued: true, reason: "offline", key: idempotencyKey };
  }

  // A write with an idempotency key is kept on the device first: if the app is
  // closed or reloaded while it's on its way, it's still here and goes out on
  // the next start (the key stops a duplicate if the first send did arrive).
  // Taken off once the server has answered.
  const kept = idempotencyKey ? enqueue({ url, body, label, idempotencyKey }, { sending: true }) : null;
  const settle = () => {
    if (!kept) return;
    dequeue(kept.id);
    sending.delete(kept.id);
  };

  const controller = new AbortController();
  const endSlow = slowNotice(label);
  const timeoutTimer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(idempotencyKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    endSlow();
    clearTimeout(timeoutTimer);
    // Answered (refused or done): nothing to resend.
    settle();

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      let error = text;
      try {
        const json = JSON.parse(text) as { error?: string };
        if (json.error) error = json.error;
      } catch {}
      // Always hand the caller a Hebrew message — never a raw English server error.
      return { queued: false, ok: false, status: response.status, error: toHebrewError(error) };
    }

    const data = await response.json().catch(() => null);
    return { queued: false, ok: true, data };
  } catch {
    // Aborted by our timeout, or a network error while the browser still thinks
    // it's "online" (the classic flaky-connection case). Queue it — the
    // idempotency key keeps a replay from creating a duplicate even if the
    // request actually reached the server before we gave up.
    endSlow();
    clearTimeout(timeoutTimer);
    if (kept) {
      sending.delete(kept.id);
      emit(CONNECTION_EVENTS.changed);
    } else {
      enqueue({ url, body, label, idempotencyKey });
    }
    emit(CONNECTION_EVENTS.queued, { label, reason: "slow" });
    return { queued: true, reason: "slow", key: idempotencyKey };
  }
}

// ── Queue processor ───────────────────────────────────────────────────────────

export type ProcessResult = { processed: number; failed: number; remaining: number };

/**
 * What a save given up on was — for the report, so the next one says which
 * save and why (סאלח's two said only "1", 24–25/10). Never its content.
 */
export type ParkedNote = { label: string; path: string; status: number | null; error: string };

/** Treat 4xx (except 408/429) as permanent — retrying won't help. */
function isPermanentFailure(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** A delete route — "/api/…/delete". */
export function isDeleteUrl(url: string): boolean {
  return /\/delete(?:$|[?#])/.test(url);
}

export async function processQueue(): Promise<ProcessResult> {
  let processed = 0;
  let failed = 0;
  const parked: ParkedNote[] = [];
  const park = (entry: QueueEntry, error: string, status: number | null) => {
    failEntry(entry, error);
    failed++;
    parked.push({ label: entry.label, path: entry.url.split("?")[0], status, error: error.slice(0, 200) });
  };

  // Re-read the queue each iteration so we always see the freshest attempt counts.
  for (let entry = waiting()[0]; entry; entry = waiting()[0]) {
    if (typeof navigator !== "undefined" && !navigator.onLine) break;

    let body = entry.body;
    if (entry.after) {
      const id = queuedResultId(entry.after.key, entry.after.idPath);
      if (!id) {
        if (queuedKeyFailed(entry.after.key)) {
          park(entry, "השמירה שזה שייך אליה לא נקלטה.", null);
          continue;
        }
        // What it waits for hasn't gone out yet — a later pass sends both.
        break;
      }
      body = withId(entry.body, id);
    }

    try {
      const response = await fetch(entry.url, {
        method: "POST",
        headers: buildHeaders(entry.idempotencyKey),
        body: JSON.stringify(body),
      });

      if (response.ok) {
        // Kept for whatever waits on this save (its new row's id).
        if (entry.idempotencyKey) {
          const data = await response.json().catch(() => null);
          if (data) rememberResult(entry.idempotencyKey, data);
        }
        dequeue(entry.id);
        processed++;
        continue;
      }

      const text = await response.text().catch(() => response.statusText);
      let error = text;
      try {
        const json = JSON.parse(text) as { error?: string };
        if (json.error) error = json.error;
      } catch {}
      const hebrewError = toHebrewError(error);

      // Deleting something that's already gone did what it was meant to — a
      // delete sent again because its first try (slow) did arrive after all.
      if (response.status === 404 && isDeleteUrl(entry.url)) {
        dequeue(entry.id);
        processed++;
        continue;
      }

      if (isPermanentFailure(response.status)) {
        park(entry, hebrewError, response.status);
        continue;
      }

      // Transient server error (5xx/408/429) — bump attempts, park if exhausted.
      const attempts = entry.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        park(entry, hebrewError, response.status);
      } else {
        writeQueue(readQueue().map((e) => (e.id === entry.id ? { ...e, attempts } : e)));
        // Stop this pass; let a later trigger retry so we don't hammer the server.
        break;
      }
    } catch {
      // Network error mid-processing — connectivity dropped again. Stop without
      // counting an attempt (it isn't the request's fault) and retry later.
      break;
    }
  }

  if (processed > 0) emit(CONNECTION_EVENTS.synced, { count: processed });
  if (failed > 0) emit(CONNECTION_EVENTS.failed, { count: failed, items: parked });

  return { processed, failed, remaining: waiting().length };
}
