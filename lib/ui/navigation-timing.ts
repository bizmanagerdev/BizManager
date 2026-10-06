// When the last page change started (performance.now()), for timing how long
// a page takes to show. 0 = the page load itself (performance.now() counts
// from the start of the load). Taps on in-app links, the app's own navigation
// start (TopNavigationProgress's emitNavigationStart) and back/forward all
// count.

const NAV_START_EVENT = "app:navigation-start";

let lastStart = 0;
let installed = false;

export function installNavigationTiming(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const mark = () => {
    lastStart = performance.now();
  };
  window.addEventListener(NAV_START_EVENT, mark);
  window.addEventListener("popstate", mark);
  window.addEventListener(
    "click",
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor?.href || anchor.target === "_blank") return;
      try {
        if (new URL(anchor.href).origin === window.location.origin) mark();
      } catch {
        // Not a URL.
      }
    },
    true
  );
}

export function lastNavigationStart(): number {
  return lastStart;
}
