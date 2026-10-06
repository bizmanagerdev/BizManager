-- ════════════════════════════════════════════════════════════════════════════
-- PowerSync: also follow attendance_sessions (worked shifts), for the
-- dashboard's attendance card (its 7-day chart reads shift start times).
-- Same as 20261006180000_powersync_dashboard_tables.sql: read-only access for
-- powersync_role, and the `powersync` publication carries the table. Devices
-- get it only through powersync/sync-config.yaml — admins and office only.
--
-- ROLLBACK: supabase/rollbacks/20261006200000_powersync_attendance_sessions.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

grant select on table public.attendance_sessions to powersync_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'powersync' and schemaname = 'public' and tablename = 'attendance_sessions'
  ) then
    alter publication powersync add table public.attendance_sessions;
  end if;
end $$;
