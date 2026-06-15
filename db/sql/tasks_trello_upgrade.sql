-- Run this in Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Trello-style tasks upgrade:
-- - tasks gain a time (due_time), a location (city / address).
-- - task_members: many users per task (assigned_user_id stays the primary owner
--   so all existing logic keeps working; members are extra collaborators).
-- - task_comments: real comment rows (replaces cramming comments into tasks.notes;
--   legacy notes are still rendered for back-compat).
-- - reminders gain a task_id link + notified_at (push de-dup) so a task can carry
--   reminders that fire in-app and via web-push.

-- ─── helper functions (security definer; avoid RLS recursion) ────────────────────
-- task_-prefixed so they never clash with anything already in the schema.
create or replace function public.task_current_user_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.users where auth_user_id = auth.uid() limit 1;
$$;

create or replace function public.task_is_office_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid()
      and u.role in ('admin', 'office')
      and u.active = true
      and coalesce(u.system_access, false) = true
  );
$$;

-- ─── tasks: new columns ─────────────────────────────────────────────────────────
alter table public.tasks
  add column if not exists due_time text,   -- 'HH:MM' (nullable)
  add column if not exists city text,
  add column if not exists address text;

-- ─── task_members ────────────────────────────────────────────────────────────────
create table if not exists public.task_members (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists task_members_task_idx on public.task_members (task_id);
create index if not exists task_members_user_idx on public.task_members (user_id);

-- can_access_task references task_members, so define it after the table exists.
create or replace function public.task_can_access(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.task_is_office_admin()
      or exists (
        select 1 from public.tasks t
        where t.id = p_task_id and t.assigned_user_id = public.task_current_user_id()
      )
      or exists (
        select 1 from public.task_members m
        where m.task_id = p_task_id and m.user_id = public.task_current_user_id()
      );
$$;

-- is the current user allowed to manage (add/remove) a task's members / metadata?
create or replace function public.task_can_manage(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.task_is_office_admin()
      or exists (
        select 1 from public.tasks t
        where t.id = p_task_id and t.assigned_user_id = public.task_current_user_id()
      );
$$;

-- ─── task_comments ───────────────────────────────────────────────────────────────
create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid references public.users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);

create or replace function public.set_task_comments_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists task_comments_set_updated_at on public.task_comments;
create trigger task_comments_set_updated_at
  before update on public.task_comments
  for each row execute function public.set_task_comments_updated_at();

-- ─── reminders: link to a task + push de-dup marker ──────────────────────────────
alter table public.reminders
  add column if not exists task_id uuid references public.tasks(id) on delete cascade,
  add column if not exists notified_at timestamptz;

-- Relax legacy constraints from the older Module-9 reminders spec so a task reminder
-- (which targets a task, not a customer/order/project) can be inserted with no note.
alter table public.reminders drop constraint if exists reminders_target_check;
do $$
begin
  alter table public.reminders alter column content drop not null;
exception when others then
  null;
end $$;

create index if not exists reminders_task_idx on public.reminders (task_id);
-- powers the push cron: pending, due, not-yet-notified.
create index if not exists reminders_due_unsent_idx
  on public.reminders (status, remind_at) where notified_at is null;

-- ─── RLS: task_members ───────────────────────────────────────────────────────────
alter table public.task_members enable row level security;

drop policy if exists task_members_select on public.task_members;
create policy task_members_select on public.task_members
  for select to authenticated
  using (user_id = public.task_current_user_id() or public.task_can_access(task_id));

drop policy if exists task_members_insert on public.task_members;
create policy task_members_insert on public.task_members
  for insert to authenticated
  with check (public.task_can_manage(task_id));

drop policy if exists task_members_delete on public.task_members;
create policy task_members_delete on public.task_members
  for delete to authenticated
  using (public.task_can_manage(task_id));

-- ─── RLS: task_comments ──────────────────────────────────────────────────────────
alter table public.task_comments enable row level security;

drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments
  for select to authenticated
  using (public.task_can_access(task_id));

drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments
  for insert to authenticated
  with check (public.task_can_access(task_id) and author_id = public.task_current_user_id());

drop policy if exists task_comments_update on public.task_comments;
create policy task_comments_update on public.task_comments
  for update to authenticated
  using (author_id = public.task_current_user_id() or public.task_is_office_admin());

drop policy if exists task_comments_delete on public.task_comments;
create policy task_comments_delete on public.task_comments
  for delete to authenticated
  using (author_id = public.task_current_user_id() or public.task_is_office_admin());

-- ─── RLS: reminders — additive policies for task reminders ───────────────────────
-- These are OR'd with the existing collection policies ("Office manages reminders",
-- "Assignee reads/updates own reminders"); they let a worker create + manage the
-- reminders they author or that belong to a task they can access.
drop policy if exists reminders_self_or_task_select on public.reminders;
create policy reminders_self_or_task_select on public.reminders
  for select to authenticated
  using (
    created_by = public.task_current_user_id()
    or (task_id is not null and public.task_can_access(task_id))
  );

drop policy if exists reminders_self_insert on public.reminders;
create policy reminders_self_insert on public.reminders
  for insert to authenticated
  with check (created_by = public.task_current_user_id());

drop policy if exists reminders_self_or_task_update on public.reminders;
create policy reminders_self_or_task_update on public.reminders
  for update to authenticated
  using (
    created_by = public.task_current_user_id()
    or (task_id is not null and public.task_can_access(task_id))
  );

-- ─── grants ──────────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.task_members to authenticated;
grant select, insert, update, delete on public.task_comments to authenticated;
