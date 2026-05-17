const QUEUE_KEY = "biz_offline_queue";
const DRAFT_PREFIX = "biz_draft:";

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
}

export function getQueue(): QueueEntry[] {
  return readQueue();
}

export function getQueueLength(): number {
  return readQueue().length;
}

export function enqueue(entry: Omit<QueueEntry, "id" | "queuedAt">): QueueEntry {
  const full: QueueEntry = {
    ...entry,
    id: crypto.randomUUID(),
    queuedAt: Date.now(),
  };
  writeQueue([...readQueue(), full]);
  return full;
}

export function dequeue(id: string): void {
  writeQueue(readQueue().filter((e) => e.id !== id));
}

// ── Smart fetch ───────────────────────────────────────────────────────────────

export type OfflineFetchResult =
  | { queued: true }
  | { queued: false; ok: true; data: unknown }
  | { queued: false; ok: false; status: number; error: string };

/**
 * If the device is definitively offline, enqueues the request and returns { queued: true }.
 * Otherwise executes the POST immediately. Does NOT queue on network errors while online
 * to avoid creating duplicates when the server may have already processed the request.
 */
export async function offlineFetch(
  url: string,
  body: Record<string, unknown>,
  label: string
): Promise<OfflineFetchResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    enqueue({ url, body, label });
    return { queued: true };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    let error = text;
    try {
      const json = JSON.parse(text) as { error?: string };
      if (json.error) error = json.error;
    } catch {}
    return { queued: false, ok: false, status: response.status, error };
  }

  const data = await response.json().catch(() => null);
  return { queued: false, ok: true, data };
}

// ── Queue processor ───────────────────────────────────────────────────────────

export type ProcessResult = { processed: number; failed: number; remaining: number };

export async function processQueue(): Promise<ProcessResult> {
  const queue = readQueue();
  let processed = 0;
  let failed = 0;

  for (const entry of queue) {
    if (typeof navigator !== "undefined" && !navigator.onLine) break;
    try {
      const response = await fetch(entry.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry.body),
      });
      if (response.ok) {
        dequeue(entry.id);
        processed++;
      } else {
        failed++;
      }
    } catch {
      // Network error mid-processing — stop and try again later
      break;
    }
  }

  return { processed, failed, remaining: readQueue().length };
}
