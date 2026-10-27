import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { writeAppFiles } from "./scripts/write-app-files.mjs";

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

// Where the app loads PowerSync's on-device database files from: a folder per
// SDK version, copied by scripts/copy-powersync-assets.mjs (see there for why).
const POWERSYNC_VERSION = (
  JSON.parse(readFileSync("node_modules/@powersync/web/package.json", "utf8")) as { version: string }
).version;

const nextConfig: NextConfig = {
  // Another chat's preview runs `next dev` in this same folder on the next free
  // port, and two can't share .next/dev (Next locks it): a preview past 3000
  // builds into a folder of its own port. Only .claude/launch.json sets
  // NEXT_DIST_BY_PORT, so Vercel and a plain `npm run dev` build as before.
  ...(process.env.NEXT_DIST_BY_PORT && process.env.PORT && process.env.PORT !== "3000"
    ? { distDir: `.next/port-${process.env.PORT}` }
    : {}),
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
    NEXT_PUBLIC_POWERSYNC_ASSETS: `/powersync/${POWERSYNC_VERSION}`,
  },
  compiler: {
    // The service worker's list of this build's code files, written inside
    // `next build` so Vercel deploys it (scripts/write-app-files.mjs says why).
    // withSentryConfig runs its own step after this one.
    runAfterProductionCompile: async ({ projectDir, distDir }) =>
      writeAppFiles(path.resolve(projectDir, distDir)),
  },
  experimental: {
    // recharts is the one heavy chart lib in this repo not already covered by
    // Next's built-in optimizePackageImports defaults — trims its barrel import.
    optimizePackageImports: ["recharts"],
  },
  images: {
    // All real remote photos (documents, receipts, delivery/property photos,
    // …) are served from Supabase Storage as signed URLs shaped
    // https://<project-ref>.supabase.co/storage/v1/object/sign/<bucket>/<path>?token=…
    // (see lib/storage.ts + the various createSignedUrls() call sites). The
    // wildcard subdomain is safer than hardcoding the project ref in case it
    // ever changes; the `**` pathname covers both the `sign/` and `public/`
    // object-serving variants.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/**",
      },
    ],
  },
  // The dev-mode indicator's <nextjs-portal> (Shadow DOM) sits in a
  // full-viewport click-catching layer and repeatedly intercepted Playwright
  // clicks in e2e/*.spec.ts's real CI runs — genuinely confirmed via the
  // Playwright trace, not a guess (the accessibility snapshot showed a
  // completely normal page underneath, no actual runtime error). Only off
  // for the e2e webServer specifically (playwright.config.ts sets
  // NODE_ENV=test there) — normal `npm run dev` keeps the indicator.
  devIndicators: process.env.NODE_ENV === "test" ? false : undefined,
  // NOTE: `onDemandEntries` (webpack dev server's compiled-page cache TTL) was
  // tried here to fight an e2e instability where a warmed-up route got
  // silently RE-compiled mid-test — but it did nothing, because `next dev`
  // (see package.json's `dev` script — no `--webpack` flag) runs on
  // TURBOPACK by default as of this Next version (confirmed straight from
  // Next's own source: lib/bundler.js's parseBundlerArgs — "The default is
  // turbopack when nothing is configured"). Turbopack's hot-reloader
  // (server/dev/hot-reloader-turbopack.js) has no onDemandEntries handling at
  // all; that option only exists in the webpack hot-reloader. Left as a
  // pointer so a future attempt doesn't retry the same dead end — the actual
  // fix belongs in e2e/global-setup.ts's warmup instead (wait for the
  // dialog's own content, not a fixed timeout).
  async redirects() {
    return [
      {
        // The short address (biz-h.com, no www) goes to the site's real one, as
        // Vercel's own domain redirect did until APK 1.2 — except Android's App
        // Links file. Android doesn't follow a redirect when it checks that file,
        // so with the domain-level redirect a short link (WhatsApp) opened the
        // browser first and only then the app (owner, 2026-10-11). Same 307, same
        // path and query.
        source: "/:path((?!\\.well-known/).*)",
        has: [{ type: "host", value: "biz-h.com" }],
        destination: "https://www.biz-h.com/:path",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        // A new SDK version gets a new folder, so these never change in place.
        source: "/powersync/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
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
