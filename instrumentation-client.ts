// Sentry init for the browser. No-op unless NEXT_PUBLIC_SENTRY_DSN is set.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    enabled:
      process.env.NODE_ENV === "production" ||
      process.env.NEXT_PUBLIC_SENTRY_ENABLE_DEV === "true",
    ignoreErrors: [
      // supabase-js serializes auth-token refresh across tabs with the browser's
      // navigator.locks API. With multiple tabs/instances open at once (the APK
      // and the installed PWA, or several browser tabs), one can lose the race
      // and time out acquiring the lock. This is an internal background-refresh
      // race, not something app code awaits or can wrap in try/catch, and
      // supabase-js recovers on its own (another tab already holds/finishes the
      // refresh). Confirmed live 2026-09-14: escalating alert noise with no
      // corresponding user-visible failure.
      /Acquiring process lock with name .*auth-token.* timed out/,
    ],
  });
}

// Lets Sentry trace client-side App Router navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
