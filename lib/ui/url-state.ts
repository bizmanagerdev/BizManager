// Keep a page's UI state (active tab, month in view, list/grid …) in the URL's
// query string WITHOUT a server round trip: `window.history.replaceState` is
// integrated with the Next.js router (useSearchParams updates), but unlike
// `router.replace` it does not refetch the page — so a month arrow doesn't rerun
// the page's loaders. `replaceState` (not push) so the browser's Back button
// leaves the page, not steps through every month the user flipped past.
//
// Refresh and Back both restore from the URL: a component seeds its initial
// state from useSearchParams and writes back here whenever it changes.

/**
 * Set (or, with `null`/"", remove) query params on the current URL in place.
 * Untouched params are kept, so `?focus=` deep links and other pages' state
 * survive.
 */
export function replaceSearchParams(update: Record<string, string | null | undefined>) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  let changed = false;
  for (const [key, value] of Object.entries(update)) {
    if (value == null || value === "") {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    } else if (url.searchParams.get(key) !== value) {
      url.searchParams.set(key, value);
      changed = true;
    }
  }
  if (!changed) return;
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
