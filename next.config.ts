import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  experimental: {
    turbopackUseSystemTlsCerts: true,
  },
  // Force a single canonical origin. The service worker, its caches, and the
  // Capacitor/PWA shell are all scoped to the apex host `biz-h.com`. A request
  // to `www.biz-h.com` is a DIFFERENT origin to the browser, so it has no SW
  // and no cache — which is why offline hit Chrome's native ERR_FAILED page
  // instead of our cached pages / offline screen. Redirect www → apex so there
  // is only ever one origin that owns the caches.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.biz-h.com" }],
        destination: "https://biz-h.com/:path*",
        permanent: true,
      },
    ];
  },
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
