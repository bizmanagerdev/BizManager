// A render error caught by a React error boundary (app/(app)/error.tsx,
// app/global-error.tsx) that matches a known "stale/mismatched build"
// signature gets ONE automatic hard reload instead of sitting on the crash
// screen waiting for the user to notice a "try again" button — reset() alone
// re-renders the SAME segment against the SAME already-loaded (broken)
// module, so it can never fix this class of failure; only a real navigation
// (letting the service worker serve the CURRENT build) can. Confirmed live
// 2026-09-14: "Rendered more hooks than during the previous render" on
// /dashboard, a single first-time event landing in the middle of a burst of
// same-day deploys — every hook call in that day's actual code changes reads
// as correctly unconditional, which fits a hydration/version-skew symptom
// (SSR HTML from one build reconciling against CSR JS from another) far
// better than a real Rules-of-Hooks bug sitting in the repo.
//
// Guarded so it can never loop: if the reload doesn't fix it, the boundary
// just renders normally (or throws again, unmasked) the second time. Shares
// its sessionStorage key with the inline bootstrap script in app/layout.tsx
// — that one catches the sibling case, a failure severe enough that no React
// boundary ever gets the chance to run at all (a <script> tag itself 404s) —
// so only one reload ever fires regardless of which path notices first. That
// script runs before any module graph exists and can't import this file, so
// keep its copy of RELOAD_KEY/the regex in sync by hand if either changes.
const RELOAD_KEY = "__chunk_reload__";

const STALE_BUILD_RX =
  /ChunkLoadError|Loading chunk [\w.-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Rendered (more|fewer) hooks than (during the previous render|expected)/i;

/** Returns true if it triggered a reload (caller can skip its own fallback UI work). */
export function reloadIfStaleBuild(error: Error): boolean {
  if (typeof window === "undefined") return false;
  if (!STALE_BUILD_RX.test(error.message ?? "")) return false;
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return false;
    sessionStorage.setItem(RELOAD_KEY, "1");
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
