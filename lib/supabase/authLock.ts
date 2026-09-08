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
// tab-focus) is not — it self-resolves and the page keeps working. Coming
// back to a backgrounded tab fires a burst of exactly those passive calls at
// once with no click involved, so toasting on every timeout regardless of
// cause meant a toast on every tab-switch — confirmed live 2026-09-09, not
// what was wanted. Only surface the toast when the lock ACQUISITION ATTEMPT
// itself started shortly after a real pointer/key interaction (tracked here,
// not when the eventual timeout fires up to lockAcquireTimeout ms later).
// Sentry still gets every timeout either way, tagged `interactive`, so
// nothing is lost for diagnosis — only what reaches the user is filtered.
const INTERACTION_WINDOW_MS = 2000;
let lastInteractionAt = 0;

if (typeof window !== "undefined") {
  const mark = () => {
    lastInteractionAt = Date.now();
  };
  window.addEventListener("pointerdown", mark, { capture: true, passive: true });
  window.addEventListener("keydown", mark, { capture: true, passive: true });
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
  const interactive = startedAt - lastInteractionAt < INTERACTION_WINDOW_MS;

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
