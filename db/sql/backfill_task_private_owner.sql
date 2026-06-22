-- Run this in Supabase SQL Editor. Safe to re-run (idempotent).
--
-- private_owner_id doubles as the task's creator/owner: it is set for EVERY task
-- at creation, and ONLY that user may toggle the task's privacy (is_private).
-- There is NO separate created_by column — the private owner is the creator.
--
-- This reconciles both states:
--  * if you already ran the (now-scrapped) add_task_created_by.sql, it copies the
--    creator it computed into private_owner_id, then drops the unused column;
--  * otherwise it falls back to the assignee as the creator/owner for old rows.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'created_by'
  ) then
    update public.tasks
      set private_owner_id = created_by
      where private_owner_id is null and created_by is not null;
  end if;
end $$;

-- Fallback for any rows still without an owner (the assignee acts as creator).
update public.tasks
  set private_owner_id = assigned_user_id
  where private_owner_id is null and assigned_user_id is not null;

-- created_by is no longer used anywhere — drop it.
alter table public.tasks drop column if exists created_by;
