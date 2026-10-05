-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK for supabase/migrations/20261005210000_powersync_probe.sql
--
-- Run once the PowerSync test is over — AFTER deleting (or disconnecting) the
-- PowerSync instance, so nothing is still following the change feed.
--
-- PowerSync keeps a replication slot in the database while it's connected; a
-- slot left behind holds on to the change log and the database grows. The last
-- statement removes any that remain.
-- ════════════════════════════════════════════════════════════════════════════

drop publication if exists powersync;
drop table if exists public.powersync_probe;
drop role if exists powersync_role;

select pg_drop_replication_slot(slot_name)
from pg_replication_slots
where slot_name like 'powersync%' and not active;
