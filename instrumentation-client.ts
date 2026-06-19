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
  });
}

// Lets Sentry trace client-side App Router navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
