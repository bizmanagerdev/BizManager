// The device versions' last results, kept on the device between visits — so
// opening the app shows each page at once, before the device database has
// even opened (a second or two on a phone), and the fresh result replaces it
// moments later (lib/powersync/local-results.ts).
//
// Per person (the key starts with their users.id), a day old at most, the most
// recent STORED_RESULTS_MAX of them; wiped at logout and when someone else
// signs in on this device. Same idea as the dashboard's remembered money cards
// (lib/ui/remembered-cards.ts).

const PREFIX = "bizh-local:";
export const STORED_RESULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STORED_RESULTS_MAX = 24;

// Stored as "<savedAt>|<json>", so its age is read without parsing it all.
function savedAtOf(raw: string): number {
  const bar = raw.indexOf("|");
  return bar > 0 ? Number(raw.slice(0, bar)) : 0;
}

function ourKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

/** Drop what's past its age, then the oldest beyond the limit. */
function trim(limit = STORED_RESULTS_MAX) {
  const now = Date.now();
  const entries = ourKeys().map((key) => ({ key, savedAt: savedAtOf(localStorage.getItem(key) ?? "") }));
  const keep = entries.filter((e) => now - e.savedAt < STORED_RESULT_MAX_AGE_MS).sort((a, b) => b.savedAt - a.savedAt);
  const keepKeys = new Set(keep.slice(0, limit).map((e) => e.key));
  for (const e of entries) if (!keepKeys.has(e.key)) localStorage.removeItem(e.key);
}

/** Keep `data` as the last result for `key` (a resultKey); `json` if it's already serialised. */
export function storeResult(key: string, data: unknown, json = JSON.stringify(data)): void {
  try {
    localStorage.setItem(PREFIX + key, `${Date.now()}|${json}`);
    trim();
  } catch {
    // Storage full or blocked: make room once; otherwise the page just works it out next time.
    try {
      trim(Math.floor(STORED_RESULTS_MAX / 2));
      localStorage.setItem(PREFIX + key, `${Date.now()}|${json}`);
    } catch {
      // Still no room.
    }
  }
}

/** The result's JSON inside a stored text — to tell whether a fresh result is the same. */
export function storedResultJson(raw: string | null): string | null {
  return raw ? raw.slice(raw.indexOf("|") + 1) : null;
}

/**
 * The stored text for `key` while it's under a day old — a stable snapshot
 * for useSyncExternalStore — or null.
 */
export function readStoredResultRaw(key: string): string | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw && Date.now() - savedAtOf(raw) < STORED_RESULT_MAX_AGE_MS ? raw : null;
  } catch {
    return null;
  }
}

/** The result in a stored text (readStoredResultRaw), or null. */
export function parseStoredResult(raw: string | null): { data: unknown } | null {
  if (!raw) return null;
  try {
    return { data: JSON.parse(raw.slice(raw.indexOf("|") + 1)) as unknown };
  } catch {
    return null;
  }
}

/** Logout (no `keepUserId`), or someone else signed in: forget the stored results. */
export function clearStoredResults(keepUserId?: string): void {
  try {
    for (const key of ourKeys()) {
      if (!keepUserId || !key.startsWith(`${PREFIX}${keepUserId}|`)) localStorage.removeItem(key);
    }
  } catch {
    // Nothing stored, or storage blocked.
  }
}
