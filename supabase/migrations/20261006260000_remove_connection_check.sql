-- ════════════════════════════════════════════════════════════════════════════
-- The connection check is over (2026-10-05/06: PowerSync works on every
-- admin's phone and computer, NetFree and Hadran included), and its code is
-- gone from the app. This removes its two tables:
--   connection_checks — the saved results of each run (18 rows)
--   powersync_probe   — the live test row the check timed through PowerSync
-- powersync_probe leaves PowerSync's publication first. Everything else the
-- probe's migration made stays: powersync_role and the `powersync`
-- publication are what PowerSync syncs the app's data through now.
--
-- Run after the sync rules without powersync_probe (v1.5) are deployed.
--
-- ROLLBACK: supabase/rollbacks/20261006260000_remove_connection_check.rollback.sql
-- (recreates the empty tables; the removed rows don't come back).
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'powersync' and schemaname = 'public' and tablename = 'powersync_probe'
  ) then
    alter publication powersync drop table public.powersync_probe;
  end if;
end $$;

drop table if exists public.powersync_probe;
drop table if exists public.connection_checks;

commit;
