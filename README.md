# BizManager

Hebrew (RTL) business-management system for an Israeli business: projects, sales
orders, customers, financials, payroll, collections, documents and more.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript (strict) · Supabase
(Postgres + Auth + RLS + Storage) · Tailwind v4 + Radix · Vitest.
Hosting: Vercel (`fra1`) · DB region: `eu-central-1` (Frankfurt).

## Bootstrap (from zero)

Prerequisites: **Node 20+** and **npm**. Get the project secrets from the owner.

```bash
npm install
cp .env.example .env     # then fill in real values (see below)
npm run dev              # http://localhost:3000
```

### Environment variables

`.env.example` is the source of truth for what's required — copy it and fill in
each value. Real `.env*` files are gitignored; never commit secrets.

| Variable | Where to get it |
|----------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (server-only; needed for cron + payroll) |
| `OPENAI_API_KEY` | platform.openai.com — all AI (voice, transcription, PDF extract) |
| `MORNING_*` | Morning/GreenInvoice invoicing credentials |
| `VAPID_*`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `npx web-push generate-vapid-keys` |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `DEFAULT_PRODUCT_CATEGORY_ID`, `PAYROLL_ADMIN_PASSWORD` | app config |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry (optional; blank disables locally) |

## Quality gate (must pass before merge)

CI (`.github/workflows/ci.yml`) runs these on every push/PR — run them locally first:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest run
```

## Database changes

Schema changes go through versioned migrations in `supabase/migrations/` only;
`db/sql/` is frozen (CI enforces it). See
[`supabase/migrations/README.md`](supabase/migrations/README.md).

```bash
npm run db:new <name>   # create a migration
npm run db:push         # apply pending migrations
```

## More

- Engineering process, money-code rules, code style, directory map →
  [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Morning integration → [`docs/morning-integration.md`](docs/morning-integration.md)
