-- Rollback for 20261009200000_task_snoozes.sql: drops the snoozes (every
-- snoozed task shows again at once). Deploy sync rules without task_snoozes
-- first, or the PowerSync service reports the missing table.

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'powersync' and schemaname = 'public' and tablename = 'task_snoozes'
  ) then
    alter publication powersync drop table public.task_snoozes;
  end if;
end $$;

drop table if exists public.task_snoozes;
