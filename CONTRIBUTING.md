# Contributing to BizManager

This is the engineering process for BizManager. The goal is simple: **process stays ahead of features.** Every change is type-checked, linted, and tested before it merges, and the database schema is versioned — so a second engineer can be productive on day one and nothing breaks silently.

## Stack

- **Next.js 16 (App Router) + React 19 + TypeScript (strict)**
- **Supabase (Postgres)** — auth, RLS, data, storage
- **Tailwind v4 + Radix** — UI
- **Vitest** — tests · **ESLint** — lint
- Hosting: **Vercel** (`fra1`) · DB region: **eu-central-1 (Frankfurt)**

## Getting started

```bash
npm install
cp .env.example .env   # fill in Supabase + OpenAI + Morning keys (ask the owner)
npm run dev
```

Required env (see `.env`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, Morning keys, `CRON_SECRET`, `NEXT_PUBLIC_SENTRY_DSN`.

## The quality gate (must pass before merge)

CI (`.github/workflows/ci.yml`) runs these on every push and PR. Run them locally first:

```bash
npm run typecheck   # tsc --noEmit — zero errors
npm run lint        # eslint — zero errors (warnings allowed, for now)
npm test            # vitest run — all green
```

A red gate blocks the merge. Do not bypass it.

## Database changes — versioned migrations only

> ⚠️ **Policy:** All schema changes go through `supabase/migrations/` (ordered, versioned, tracked). `db/sql/` is **frozen** — CI (`npm run db:check`) fails on any new file there. Full runbook + one-time baseline setup: [`supabase/migrations/README.md`](supabase/migrations/README.md).

```bash
npm run db:new <name>     # create supabase/migrations/<ts>_<name>.sql
# write idempotent SQL, then:
npm run db:push           # apply pending migrations to the linked project
```

Rules:
- Migrations must be **idempotent** (`create ... if not exists`, `drop policy if exists`, etc.).
- Never edit an already-applied migration — add a new one.
- If a change touches an RPC, the migration is the source of truth; the deployed function must match it.
- Never add to `db/sql/` — the freeze is enforced in CI.

## Money code — extra care

The financial layer is being consolidated toward **one source of truth** (`lib/financial/`). Until that's done:
- Any change touching payments / expenses / VAT / balances **must** ship with a Vitest test.
- Refunds are negative-amount payment rows → they are **outflows / contra-revenue**, never income. There are regression tests for this in `__tests__/lib/financial/entries.test.ts`; keep them green.
- Prefer SQL-side aggregation (views/RPCs) over pulling whole tables into Node.

## Code style

- **Keep components small.** New UI should be composed of focused components; do not grow the existing 2,000–5,000-line `*Client.tsx` files. When you touch one, leave it smaller than you found it where practical.
- Business logic lives in `lib/`, not in components.
- All user-facing text is **Hebrew**; map server errors via `toHebrewError`. Never surface raw English.
- Use the shared UI primitives (`components/ui/*`) — `CurrencyInput`, `SearchableSelect`, `ConfirmDialog`, etc.

## Where things live

| Area | Path |
|------|------|
| Pages / routes | `app/(app)/**` |
| API handlers | `app/api/**/route.ts` |
| Domain logic | `lib/**` (financial engine in `lib/financial/`) |
| UI primitives | `components/ui/**` |
| Tests | `__tests__/**` |
| Migrations | `supabase/migrations/**` (legacy: `db/sql/**`) |
