// Which version of the app is running, and whether a newer one is live
// (owner, 2026-10-20: the phone app stayed on 10-17's version for days). An
// app Android keeps alive is resumed, never reopened, so it never loaded a new
// page — and Vercel's skew protection kept answering its old version. Asking
// the server which build it runs now (/api/ping's header, a plain request, not
// pinned to the old deployment) tells the app there is something to move to;
// components/pwa/PwaRegistration reloads onto it once the app is left.

/** /api/ping's answer header: the build the server runs now. */
export const BUILD_HEADER = "X-Bizh-Build";

/** The build this page's code is. */
export const RUNNING_BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "";

/** True when the server runs another build than this page. */
export function isNewerBuild(live: string | null | undefined, running: string = RUNNING_BUILD): boolean {
  return Boolean(live && running && live !== running);
}

/** The build a service worker was registered for ("/sw.js?v=<build>"), or null. */
export function swBuildOf(scriptURL: string | null | undefined): string | null {
  if (!scriptURL) return null;
  try {
    return new URL(scriptURL, "https://x.invalid").searchParams.get("v");
  } catch {
    return null;
  }
}

/** Asks the server which build it runs now; null when it can't say (offline, an old server). */
export async function liveBuild(): Promise<string | null> {
  try {
    const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(5000) : undefined;
    const res = await fetch("/api/ping", { cache: "no-store", signal });
    return res.headers.get(BUILD_HEADER);
  } catch {
    return null;
  }
}

const TRIED_KEY = "__bizh_update_tried__";
/** A reload that didn't move the app off its build may be tried again after this long. */
export const UPDATE_RETRY_MS = 10 * 60 * 1000;

/**
 * May the app reload now to leave `running`? Once per build, and again only
 * after UPDATE_RETRY_MS — a reload that lands on the same build again (a slow
 * line answered from the saved copy) never loops, but an app left open for days
 * still moves on at every deploy. (It used to be once per session: a session
 * that never ends never updated again.)
 */
export function mayReloadFrom(running: string = RUNNING_BUILD, now: number = Date.now()): boolean {
  try {
    const raw = sessionStorage.getItem(TRIED_KEY);
    if (!raw) return true;
    const [build, at] = raw.split("|");
    return build !== running || now - Number(at) >= UPDATE_RETRY_MS;
  } catch {
    return true;
  }
}

/** Remembers that a reload was tried from `running` just now. */
export function noteReloadFrom(running: string = RUNNING_BUILD, now: number = Date.now()): void {
  try {
    sessionStorage.setItem(TRIED_KEY, `${running}|${now}`);
  } catch {
    // Storage blocked: nothing remembered (a loop is still bounded by visibility changes).
  }
}
