-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for supabase/migrations/20261005200000_connection_checks.sql
--
-- Removes the temporary connection-check results table and everything stored
-- in it. Run once the connection check is taken out of the app (or to undo the
-- migration); nothing else depends on this table.
-- ════════════════════════════════════════════════════════════════════════════

drop table if exists public.connection_checks;
