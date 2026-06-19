// Sentry init for the Node.js (server) runtime. Loaded from instrumentation.ts.
// Stays a no-op unless NEXT_PUBLIC_SENTRY_DSN is set (so dev/builds are unaffected
// until you create a Sentry project and add the DSN).
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Sample a fraction of traces in production to control cost; full in dev.
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // Only report in production by default; opt into dev with SENTRY_ENABLE_DEV=true.
    enabled: process.env.NODE_ENV === "production" || process.env.SENTRY_ENABLE_DEV === "true",
  });
}
