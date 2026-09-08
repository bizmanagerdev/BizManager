# E2E tests (Playwright)

These run against a **fully local** stack — Next dev + a local Supabase
(Postgres/Auth/API) started via Docker — never against the real business
database. That's deliberate: a Playwright test drives a real browser through
the real app, which means real writes (creating an order, logging in, etc.),
and this business has no separate staging Supabase project. Pointing these
at production would create fake orders/customers/payments that real staff
would see and that would pollute real financial reports.

## One-time setup

1. Docker Desktop must be running.
2. Start the local Supabase stack (safe — never touches the linked remote
   project; only `supabase db push/pull/diff` do that):
   ```bash
   npx supabase start
   ```
   This applies every migration in `supabase/migrations/` plus
   `supabase/seed.sql` (three test logins — see below) to a fresh local DB,
   and prints the local API URL + anon key + service_role key.
3. Copy the env template and fill in those three values:
   ```bash
   cp .env.test.example .env.test.local
   ```
4. Install the browser binary once: `npx playwright install chromium`

## Running

```bash
npm run test:e2e          # headless, starts Next dev automatically
npm run test:e2e:ui       # Playwright's interactive UI mode
```

`playwright.config.ts`'s `webServer` starts `npm run dev` itself using
`.env.test.local` — you don't need a dev server already running (though if
one's already up on :3000, it reuses it, so **make sure any dev server you
already have running is ALSO pointed at the local stack**, not production,
before running these).

## Seeded test logins (`supabase/seed.sql`)

All three share the password `e2e-test-password-123`:

| Role | Email |
|---|---|
| admin | `e2e-admin@bizh.test` |
| office | `e2e-office@bizh.test` |
| worker | `e2e-worker@bizh.test` |

Fixed, well-known, non-secret on purpose — this is a throwaway local
database that gets rebuilt from migrations, not a real credential.

## Resetting the local DB

```bash
npx supabase db reset
```

Re-applies every migration + the seed from scratch — use this after pulling
new migrations, or whenever local data gets messy from a test run.

## Stopping

```bash
npx supabase stop
```
