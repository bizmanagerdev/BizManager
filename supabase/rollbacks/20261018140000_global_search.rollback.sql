-- Rollback for 20261018140000_global_search.sql.
-- Removes the global search's two read-only functions. No table or row is
-- touched by the migration, so nothing else needs restoring. The app's search
-- (lib/global-search.ts) calls public.global_search, so roll the code back
-- together with this.

drop function if exists public.global_search(jsonb, text, text[], integer);
drop function if exists public.global_search_vocab();
