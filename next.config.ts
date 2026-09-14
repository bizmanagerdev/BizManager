import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Identifies THIS deploy. The service worker keys its caches on this value and
// is registered as `/sw.js?v=<BUILD_ID>`, so every deploy produces a new SW
// script URL -> install -> activate -> old caches purged. Before this, the
// version was hardcoded in public/sw.js and only changed when someone manually
// edited the file, so a device could serve build-A HTML pointing at build-A
// chunks that the CDN no longer had -> blank white screen with no error.
//
// On Vercel the commit SHA is stable and unique per deploy. BUILD_ID is an
// escape hatch for self-hosted builds. The literal fallback matches the last
// hand-written version so existing caches aren't needlessly invalidated when
// neither is set.
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ??
  process.env.BUILD_ID ??
  "v13";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  experimental: {
    turbopackUseSystemTlsCerts: true,
  },
  // The dev-mode indicator's <nextjs-portal> (Shadow DOM) sits in a
  // full-viewport click-catching layer and repeatedly intercepted Playwright
  // clicks in e2e/*.spec.ts's real CI runs — genuinely confirmed via the
  // Playwright trace, not a guess (the accessibility snapshot showed a
  // completely normal page underneath, no actual runtime error). Only off
  // for the e2e webServer specifically (playwright.config.ts sets
  // NODE_ENV=test there) — normal `npm run dev` keeps the indicator.
  devIndicators: process.env.NODE_ENV === "test" ? false : undefined,
  // Next dev mode disposes an on-demand-compiled page/chunk after 60s of no
  // requests (default onDemandEntries.maxInactiveAge), keeping only the 5
  // most-recently-used (default pagesBufferLength) — so a route warmed up at
  // the start of a long, sequential e2e run gets evicted and silently
  // RE-compiled the next time a later test needs it, reproducing the exact
  // "on-demand compile -> Fast Refresh remount mid-interaction" instability
  // global-setup.ts's own warmup exists to avoid (see its header comment) —
  // confirmed via a real CI run: the SAME "element was detached from the DOM"
  // failure kept recurring, just as broadly, even after that warmup fix and
  // an unrelated auto-reload fix landed. Generous, test-only numbers (this
  // key is a `next dev`-only mechanism with zero effect on a production
  // build) so every route/dialog chunk the suite touches stays compiled for
  // the whole run instead of cycling in and out.
  onDemandEntries:
    process.env.NODE_ENV === "test"
      ? { maxInactiveAge: 60 * 60 * 1000, pagesBufferLength: 100 }
      : undefined,
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
    ];
  },
};

// Wrap with Sentry. Source maps upload only when SENTRY_ORG/PROJECT/AUTH_TOKEN
// are set (e.g. in Vercel); otherwise the build still succeeds untouched.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
});
