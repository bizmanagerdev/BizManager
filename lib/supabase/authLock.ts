import { navigatorLock } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";

/**
 * Diagnostic wrapper around the exclusive browser lock every client-side
 * Supabase call (auth AND every .from()/.rpc() request, via _getAccessToken)
 * must acquire before it can run. Users report silent app freezes and the
 * only trace was a bare console warning ([[auth-lock-timeout-freeze]] in
 * project memory) — this makes the real frequency measurable (Sentry) and
 * the live symptom visible (a toast, see AuthLockToasts) instead of
 * guessing. Behavior is unchanged from the default `navigatorLock` — this
 * only observes timing around it.
 */
export const AUTH_LOCK_EVENTS = {
  timeout: "biz:auth-lock-timeout", // gave up after lockAcquireTimeout, behind a real click
} as const;

const SLOW_THRESHOLD_MS = 3000;

// A lock timeout behind something the user actually tapped is worth
// interrupting them for; the SAME timeout behind a passive background call
// (a heartbeat, a realtime resubscribe, the auth client's own refresh-on-
// tab-focus) is not — it self-resolves and the page keeps working.
//
// First attempt gated only on "was there a recent pointerdown/keydown" —
// confirmed live still WRONG: switching to a browser tab, or clicking back
// into the page right after, is itself a pointerdown, so a click-based
// signal alone can't tell "clicked to switch tabs" apart from "clicked a
// button." Fixed by adding an explicit veto on `visibilitychange` — the
// actual, targeted signal for "a tab/app just came back from the
// background" (same pattern PresenceTracker already uses). A lock
// acquisition attempt that started shortly after the tab became visible is
// treated as background noise even if a click also landed nearby; only a
// click with NO recent visibility change counts as interactive.
const INTERACTION_WINDOW_MS = 2000;
const VISIBILITY_VETO_MS = 5000;
let lastInteractionAt = 0;
let lastVisibleAt = 0;

if (typeof window !== "undefined") {
  const mark = () => {
    lastInteractionAt = Date.now();
  };
  window.addEventListener("pointerdown", mark, { capture: true, passive: true });
  window.addEventListener("keydown", mark, { capture: true, passive: true });

  if (typeof document !== "undefined") {
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "visible") lastVisibleAt = Date.now();
      },
      { capture: true, passive: true }
    );
  }
}

function emit(name: string, detail?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export async function instrumentedLock<R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>
): Promise<R> {
  const startedAt = Date.now();
  const recentClick = startedAt - lastInteractionAt < INTERACTION_WINDOW_MS;
  const recentVisibilityResume = startedAt - lastVisibleAt < VISIBILITY_VETO_MS;
  const interactive = recentClick && !recentVisibilityResume;

  try {
    const result = await navigatorLock(name, acquireTimeout, fn);
    const waitedMs = Date.now() - startedAt;
    if (waitedMs > SLOW_THRESHOLD_MS) {
      const path = typeof window !== "undefined" ? window.location.pathname : undefined;
      Sentry.addBreadcrumb({
        category: "auth-lock",
        message: "lock acquired slowly",
        level: "warning",
        data: { name, waitedMs, path, interactive },
      });
    }
    return result;
  } catch (err) {
    const waitedMs = Date.now() - startedAt;
    if ((err as { isAcquireTimeout?: boolean } | null)?.isAcquireTimeout) {
      const path = typeof window !== "undefined" ? window.location.pathname : undefined;
      Sentry.captureMessage("auth lock acquisition timed out", {
        level: "warning",
        tags: { area: "auth-lock", interactive: String(interactive) },
        extra: { name, waitedMs, path },
      });
      if (interactive) emit(AUTH_LOCK_EVENTS.timeout, { waitedMs });
    }
    throw err;
  }
}
