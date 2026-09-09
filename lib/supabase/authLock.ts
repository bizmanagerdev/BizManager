import { processLock } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";

/**
 * Wrapper around the lock every client-side Supabase call (auth AND every
 * .from()/.rpc() request, via _getAccessToken) must acquire before it can
 * run. Users reported silent app freezes — clicks doing nothing for up to
 * 10s with no spinner/error — traced to Supabase's DEFAULT browser lock
 * (`navigatorLock`, via the Web Locks API), which is EXCLUSIVE ACROSS EVERY
 * TAB/INSTANCE sharing the same origin (a phone's installed PWA + the
 * regular browser tab both count). Any one of them holding the lock — even
 * for a quiet background heartbeat or the SDK's own auto-refresh — makes
 * every OTHER instance's click sit queued for up to `lockAcquireTimeout`
 * (10s default) before failing. Confirmed live in Sentry for 2+ months
 * across 3 users, reproduced directly by the owner ([[auth-lock-timeout-
 * freeze]] in project memory).
 *
 * FIX (2026-09-10): switched the underlying lock from `navigatorLock` to
 * `processLock` — Supabase's own same-tab-only alternative (a plain in-
 * memory promise chain, no `navigator.locks` at all). Each tab now manages
 * its own session independently instead of waiting on every other open tab/
 * instance, which removes the dominant cause of the freeze. Traded off: the
 * cross-tab guarantee that only ONE tab ever refreshes the session token at
 * once is gone — in the rare case of two instances of the same account
 * racing a refresh at the exact same moment, one may need an extra silent
 * re-fetch; it does not log the user out. Given this app is used mostly one
 * device per person, this is the right trade for a confirmed, pervasive hang
 * over a rare, self-healing edge case. Server-side clients are unaffected —
 * `navigator.locks`/`processLock` are browser-only concepts, never used by
 * `createSupabaseServerClient`/`createSupabaseRouteClient`.
 *
 * This wrapper's OWN job (Sentry reporting + the live-freeze toast via
 * AuthLockToasts) is unchanged — still measures timing/timeouts around
 * whichever lock function it delegates to.
 *
 * FOLLOW-UP (2026-09-10, same day): a `processLock` timeout STILL happened
 * live right after the switch above shipped (confirmed real — the error
 * message format is unique to `processLock`, the old `navigatorLock` code
 * cannot produce it, verified by reading @supabase/auth-js's source
 * directly). Root cause is different from the cross-tab one: `processLock`
 * queues behind whatever THIS SAME TAB's previous operation is (an earlier
 * click, the SDK's own periodic auto-refresh timer, a realtime
 * resubscribe-on-focus) — if THAT operation is genuinely slow (a mobile
 * network round-trip to Supabase's Auth server having a bad moment, not a
 * true deadlock), everything queued behind it can time out even though
 * nothing is actually stuck — the front of the queue just hadn't finished
 * yet. Added ONE retry with a shorter follow-up window: if the slow
 * operation finishes a couple seconds after the first timeout (the common
 * case for transient network slowness), the retry succeeds immediately
 * instead of surfacing a failure. Worst case grows from 10s to ~14s; that's
 * an acceptable trade for turning "reliably fails" into "usually recovers."
 * Sentry/the toast only fire if BOTH attempts fail.
 */
const RETRY_TIMEOUT_MS = 4000;
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

function isAcquireTimeoutError(err: unknown): boolean {
  return Boolean((err as { isAcquireTimeout?: boolean } | null)?.isAcquireTimeout);
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
  const path = () => (typeof window !== "undefined" ? window.location.pathname : undefined);

  try {
    const result = await processLock(name, acquireTimeout, fn);
    const waitedMs = Date.now() - startedAt;
    if (waitedMs > SLOW_THRESHOLD_MS) {
      Sentry.addBreadcrumb({
        category: "auth-lock",
        message: "lock acquired slowly",
        level: "warning",
        data: { name, waitedMs, path: path(), interactive },
      });
    }
    return result;
  } catch (firstErr) {
    if (!isAcquireTimeoutError(firstErr)) throw firstErr;

    // The first attempt timed out waiting on whatever else in THIS tab is
    // holding the lock (a slow auto-refresh, a realtime resubscribe) — `fn`
    // was never invoked for that attempt, so retrying is safe (no risk of
    // running the underlying operation twice). A short second window lets a
    // transient slow moment finish and free the lock instead of failing
    // outright the first time it takes a bit too long.
    try {
      const result = await processLock(name, RETRY_TIMEOUT_MS, fn);
      Sentry.addBreadcrumb({
        category: "auth-lock",
        message: "lock acquired on retry after initial timeout",
        level: "warning",
        data: { name, waitedMs: Date.now() - startedAt, path: path(), interactive },
      });
      return result;
    } catch (secondErr) {
      if (isAcquireTimeoutError(secondErr)) {
        const waitedMs = Date.now() - startedAt;
        Sentry.captureMessage("auth lock acquisition timed out", {
          level: "warning",
          tags: { area: "auth-lock", interactive: String(interactive) },
          extra: { name, waitedMs, path: path(), retried: true },
        });
        if (interactive) emit(AUTH_LOCK_EVENTS.timeout, { waitedMs });
      }
      throw secondErr;
    }
  }
}
