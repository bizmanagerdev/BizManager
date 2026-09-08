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
  slow: "biz:auth-lock-slow", // acquired, but took a while (still fine)
  timeout: "biz:auth-lock-timeout", // gave up after lockAcquireTimeout
} as const;

const SLOW_THRESHOLD_MS = 3000;

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

  try {
    const result = await navigatorLock(name, acquireTimeout, fn);
    const waitedMs = Date.now() - startedAt;
    if (waitedMs > SLOW_THRESHOLD_MS) {
      const path = typeof window !== "undefined" ? window.location.pathname : undefined;
      Sentry.addBreadcrumb({
        category: "auth-lock",
        message: "lock acquired slowly",
        level: "warning",
        data: { name, waitedMs, path },
      });
      emit(AUTH_LOCK_EVENTS.slow, { waitedMs });
    }
    return result;
  } catch (err) {
    const waitedMs = Date.now() - startedAt;
    if ((err as { isAcquireTimeout?: boolean } | null)?.isAcquireTimeout) {
      const path = typeof window !== "undefined" ? window.location.pathname : undefined;
      Sentry.captureMessage("auth lock acquisition timed out", {
        level: "warning",
        tags: { area: "auth-lock" },
        extra: { name, waitedMs, path },
      });
      emit(AUTH_LOCK_EVENTS.timeout, { waitedMs });
    }
    throw err;
  }
}
