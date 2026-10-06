// The dashboard's money cards (payments, collections, income/expenses) are
// worked out on the server and take a moment. The last version each person saw
// is kept on their device and shown — greyed and not clickable — while the
// fresh one is on its way (components/dashboard/RememberedCard.tsx). Per
// person, a day at most, wiped at logout.

const PREFIX = "bizh-card:";
export const REMEMBERED_CARD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type RememberedEntry<P> = { kind: string; props: P; savedAt: number };

export function rememberCard<P>(key: string, kind: string, props: P | null): void {
  try {
    if (props === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify({ kind, props, savedAt: Date.now() } satisfies RememberedEntry<P>));
  } catch {
    // Storage full or blocked: the card just shows its placeholder next time.
  }
}

/**
 * The stored text of a card that's still fresh (under a day old, same kind) —
 * a stable snapshot for useSyncExternalStore — or null.
 */
export function readRememberedCardRaw(key: string, kind: string): string | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as RememberedEntry<unknown>;
    return entry.kind === kind && Date.now() - entry.savedAt < REMEMBERED_CARD_MAX_AGE_MS ? raw : null;
  } catch {
    return null;
  }
}

/** Logout: forget every remembered card on this device. */
export function clearRememberedCards(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Nothing stored, or storage blocked.
  }
}
