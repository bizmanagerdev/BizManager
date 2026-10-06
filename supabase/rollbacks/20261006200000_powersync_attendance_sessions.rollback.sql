-- ROLLBACK for supabase/migrations/20261006200000_powersync_attendance_sessions.sql

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'powersync' and schemaname = 'public' and tablename = 'attendance_sessions'
  ) then
    alter publication powersync drop table public.attendance_sessions;
  end if;
end $$;

revoke select on table public.attendance_sessions from powersync_role;
