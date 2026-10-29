// The dashboard's money cards used to keep their last version on the device
// ("bizh-card:…" in localStorage) and show it greyed while the server worked
// the fresh one out. Gone 2026-10-29: the cards have come from the device's
// copy for every admin and office user since Oct 11. What's left is the
// logout wipe — devices still hold figures saved before then, money data that
// mustn't outlive the session.

const PREFIX = "bizh-card:";

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
