# Database migrations — the one source of truth

All schema changes (tables, columns, RLS, RPCs, views, triggers) live here as
**ordered, versioned** migrations applied with the Supabase CLI. This replaces the
frozen [`db/sql/`](../../db/sql/README.md) "paste into the editor" directory.

> The CLI (`supabase`) is already a dev dependency — run it via `npx supabase …`
> or the `npm run db:*` scripts below.

## One-time setup (per machine)

```bash
npx supabase login                       # opens a browser; auth the CLI
npx supabase link --project-ref <ref>    # <ref> = the id in NEXT_PUBLIC_SUPABASE_URL
                                         #         (https://<ref>.supabase.co)
```

If `supabase/config.toml` doesn't exist yet, run `npx supabase init` first.

## Capture the baseline (do this ONCE, by whoever has DB access)

The live database is the truth today; the legacy `db/sql/` files don't reliably
describe it. Capture the real current schema as the first migration:

```bash
npm run db:pull        # supabase db pull → writes supabase/migrations/<ts>_remote_schema.sql
git add supabase/migrations && git commit -m "chore(db): baseline schema from prod"
```

After that, the repo can reproduce the schema, and `db/sql/` can be pruned.

> **Reconcile the 6 pre-existing `20260520_*` migrations.** They were applied to
> prod before the project was linked, so they're already baked into what `db pull`
> captures. Mark them as already-applied so they don't try to re-run on push:
> `npx supabase migration repair --status applied 20260520` (and verify with
> `npx supabase migration list`). Then keep the baseline as the foundation.

## Day-to-day workflow

```bash
npm run db:new <name>   # create supabase/migrations/<timestamp>_<name>.sql
#   …write idempotent SQL: create ... if not exists, drop policy if exists, etc.
npm run db:diff         # optional: see your local change as SQL
npm run db:push         # apply pending migrations to the linked project
```

## Rules

- **One change = one new migration.** Never edit an already-applied migration —
  add a new one.
- **Idempotent** SQL (`if not exists`, `drop … if exists`, `create or replace`).
- If a migration changes an **RPC**, the migration is the source of truth — the
  deployed function must match it (a class of bug we hit repeatedly under `db/sql/`).
- Never put schema in `db/sql/` again — CI (`npm run db:check`) blocks it.

## Why

No reliable way to reproduce or audit the production schema is a production-readiness
blocker. Versioned migrations give: a reproducible DB for a new engineer, an audit
trail, safe ordering, and an end to the repo-vs-prod drift that caused live bugs
(stale RPCs, order-total zeroing, dropped order notes).
