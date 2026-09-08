import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import path from "node:path";

// E2E config. Deliberately points at LOCAL Next.js + LOCAL Supabase only —
// see e2e/README.md for why (never runs against the real business database).
// `webServer` starts Next dev itself with .env.test.local, so `npm run test:e2e`
// is a single command; nothing here ever reads the app's real .env.
loadEnv({ path: path.resolve(__dirname, ".env.test.local") });

export default defineConfig({
  testDir: "./e2e",
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
  webServer: {
    command: "npm run dev",
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
