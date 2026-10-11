// "?quick=…" links: a page opened with one of these opens a form or a box at
// once — the phone app's long-press shortcuts (APK 1.2: /dashboard?quick=task,
// ?quick=order, ?quick=search). The one part of the page that handles the value
// takes it, and it's dropped from the address so Back or a refresh doesn't open
// it again.

/** The ?quick= value if it's one of `accepted` (then removed from the address), else null. */
export function takeQuickParam<T extends string>(accepted: readonly T[]): T | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const value = url.searchParams.get("quick");
  if (!value || !(accepted as readonly string[]).includes(value)) return null;
  url.searchParams.delete("quick");
  // Next's own history entry is kept; only the address changes.
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  return value as T;
}
