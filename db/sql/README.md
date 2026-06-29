# ⛔ `db/sql/` is FROZEN — legacy, do not add files here

These ~90 `.sql` files are the **old** schema-change mechanism: hand-written scripts
that were pasted into the Supabase SQL editor by hand, in an order encoded only in
English comments. There is no record of which ones were actually applied — this
directory was the **#1 source of repo-vs-prod schema drift**.

It is now **frozen**:

- **Do NOT add new files here.** CI (`npm run db:check`) fails on any new `.sql`
  that isn't in `.frozen-manifest`.
- **All schema changes go through `supabase/migrations/`** — ordered, versioned,
  tracked. See [`../../supabase/migrations/README.md`](../../supabase/migrations/README.md).
- Existing files may be **deleted** as they're confirmed applied / folded into the
  baseline migration (run `npm run db:refreeze` after pruning to update the manifest).

These files are kept only as a historical reference until the baseline migration
(captured via `supabase db pull`) fully supersedes them.
