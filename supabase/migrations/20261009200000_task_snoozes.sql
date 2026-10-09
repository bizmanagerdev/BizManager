-- ════════════════════════════════════════════════════════════════════════════
-- "לטיפול בהמשך" — handle a task later, like Gmail's snooze — per person
-- (owner, 2026-10-09: "only for you", and "it should ping when it comes
-- back"). A task someone snoozed is off THEIR board, dashboard and today list
-- until `until`, then comes back with a push (app/api/cron/reminders sends it
-- and sets notified_at). Searching still finds it. One row per task and
-- person; deleting the row un-snoozes.
--
-- Read/written only by its own person (RLS), on tasks they may open. Phones
-- keep their own rows (powersync/sync-config.yaml v1.9) — hence the grant to
-- powersync_role and the publication.
--
-- ROLLBACK: supabase/rollbacks/20261009200000_task_snoozes.rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.task_snoozes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  until timestamptz not null,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, user_id)
);

create index if not exists task_snoozes_user_until_idx on public.task_snoozes (user_id, until);
-- The push cron's lookup: snoozes that have ended and not been announced.
create index if not exists task_snoozes_due_idx on public.task_snoozes (until) where notified_at is null;

alter table public.task_snoozes enable row level security;

drop policy if exists task_snoozes_select on public.task_snoozes;
create policy task_snoozes_select on public.task_snoozes for select to authenticated
  using (user_id = (select public.task_current_user_id()));

drop policy if exists task_snoozes_insert on public.task_snoozes;
create policy task_snoozes_insert on public.task_snoozes for insert to authenticated
  with check (user_id = (select public.task_current_user_id()) and public.task_can_access(task_id));

drop policy if exists task_snoozes_update on public.task_snoozes;
create policy task_snoozes_update on public.task_snoozes for update to authenticated
  using (user_id = (select public.task_current_user_id()))
  with check (user_id = (select public.task_current_user_id()) and public.task_can_access(task_id));

drop policy if exists task_snoozes_delete on public.task_snoozes;
create policy task_snoozes_delete on public.task_snoozes for delete to authenticated
  using (user_id = (select public.task_current_user_id()));

-- Like every RLS table (20261004150000_inactive_users_lose_access.sql).
drop policy if exists active_users_only on public.task_snoozes;
create policy active_users_only on public.task_snoozes as restrictive for all to authenticated
  using ((select public.current_user_role()) is not null)
  with check ((select public.current_user_role()) is not null);

grant select, insert, update, delete on table public.task_snoozes to authenticated;
grant select on table public.task_snoozes to powersync_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'powersync' and schemaname = 'public' and tablename = 'task_snoozes'
  ) then
    alter publication powersync add table public.task_snoozes;
  end if;
end $$;
