import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import path from "node:path";

// E2E config. Deliberately points at LOCAL Next.js + LOCAL Supabase only —
// see e2e/README.md for why (never runs against the real business database).
// `webServer` starts Next itself with .env.test.local, so `npm run test:e2e`
// is a single command; nothing here ever reads the app's real .env.
loadEnv({ path: path.resolve(__dirname, ".env.test.local") });

export default defineConfig({
  testDir: "./e2e",
  // Local iteration only — see global-setup.ts's own comment for why this is
  // skipped entirely in CI (CI runs a production build, which has none of
  // the on-demand-compilation instability this warmup exists to avoid).
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,

  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "he-IL",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  // Starts the app itself against the LOCAL Supabase stack (see e2e/README.md
  // for `supabase start` — must already be running before this).
  //
  // CI serves an already-built app (a separate "Build the app" step in
  // .github/workflows/ci.yml runs first) instead of `next dev` — root-caused
  // after four separate fix attempts at patching around dev mode's on-demand
  // compilation + Fast Refresh remounting kept failing to resolve the SAME
  // "element was detached from the DOM" instability, spread broadly enough
  // (including plain nav-redirect tests touching no dialog at all) to point
  // at the CI runner's own resource pressure (a standard 2-core/7GB
  // `ubuntu-latest` box running Postgres + a live-compiling dev server + a
  // full browser all at once) rather than any single fixable interaction.
  // `next start` serves a finished build with none of that live-compilation
  // machinery — eliminating the whole class of bug at the root instead of
  // patching around individual occurrences of it. Local runs stay on
  // `next dev` for fast iteration (`reuseExistingServer` lets a dev keep
  // their own `npm run dev` open across repeated `npm run test:e2e` runs).
  webServer: {
    command: process.env.CI ? "npm run start" : "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NODE_ENV: "test",
      // Loaded from .env.test.local (gitignored) — the local Supabase stack's
      // own printed credentials, never the real project's.
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    },
  },
});
