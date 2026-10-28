// A page moved to with no connection whose data isn't on the device — no
// device version, never saved (public/sw.js answers "not saved", tellNotSaved).
// The page opens anyway and says so in its place, the way Spotify's offline
// screens do, so the person sees why and moves on (owner, 2026-10-28: "you
// find the calendar page, see there's nothing there for you, so you move to
// the next page" — staying put with a notice was more frustrating). Set by
// PwaRegistration, shown by OfflinePageGate.

let notOnDevice: string | null = null;
const listeners = new Set<() => void>();

/** The page (path and query) shown as "not on the device", or null. */
export function pageNotOnDevice(): string | null {
  return notOnDevice;
}

export function markPageNotOnDevice(address: string | null): void {
  if (notOnDevice === address) return;
  notOnDevice = address;
  for (const listener of listeners) listener();
}

export function subscribePageNotOnDevice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
