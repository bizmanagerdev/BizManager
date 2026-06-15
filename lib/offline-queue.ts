import { toHebrewError } from "@/lib/error-messages";

const QUEUE_KEY = "biz_offline_queue";
const FAILED_KEY = "biz_offline_failed";
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
  changed: "biz:queue-changed", // queue/failed counts changed (same-tab refresh)
} as const;

function emit(name: string, detail?: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
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
};

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

export function getQueue(): QueueEntry[] {
  return readQueue();
}

export function getQueueLength(): number {
  return readQueue().length;
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

export function enqueue(
  entry: Omit<QueueEntry, "id" | "queuedAt" | "attempts">
): QueueEntry {
  const full: QueueEntry = {
    ...entry,
    id: crypto.randomUUID(),
    queuedAt: Date.now(),
    attempts: 0,
  };
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
  | { queued: true; reason: "offline" | "slow" }
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
    return { queued: true, reason: "offline" };
  }

  const controller = new AbortController();
  const slowTimer = setTimeout(() => emit(CONNECTION_EVENTS.slow, { label }), SLOW_NOTICE_MS);
  const timeoutTimer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(idempotencyKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(slowTimer);
    clearTimeout(timeoutTimer);

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
    clearTimeout(slowTimer);
    clearTimeout(timeoutTimer);
    enqueue({ url, body, label, idempotencyKey });
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

export async function processQueue(): Promise<ProcessResult> {
  let processed = 0;
  let failed = 0;

  // Re-read the queue each iteration so we always see the freshest attempt counts.
  for (let entry = readQueue()[0]; entry; entry = readQueue()[0]) {
    if (typeof navigator !== "undefined" && !navigator.onLine) break;

    try {
      const response = await fetch(entry.url, {
        method: "POST",
        headers: buildHeaders(entry.idempotencyKey),
        body: JSON.stringify(entry.body),
      });

      if (response.ok) {
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

      if (isPermanentFailure(response.status)) {
        failEntry(entry, hebrewError);
        failed++;
        continue;
      }

      // Transient server error (5xx/408/429) — bump attempts, park if exhausted.
      const attempts = entry.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        failEntry(entry, hebrewError);
        failed++;
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
  if (failed > 0) emit(CONNECTION_EVENTS.failed, { count: failed });

  return { processed, failed, remaining: readQueue().length };
}
