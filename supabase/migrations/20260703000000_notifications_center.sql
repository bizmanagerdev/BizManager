-- In-app notification center: a persistent per-recipient log with read/unread,
-- separate from the live worklist. Run in the Supabase SQL Editor. Idempotent.
--
-- One row per delivered notification per recipient. user_id is the AUTH uid
-- (auth.users) — same key as push_subscriptions — so RLS is a clean
-- user_id = auth.uid(). Rows are written by the crons/notify hooks (service role,
-- bypassing RLS); users only read + mark their own read.

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,                       -- recipient AUTH uid
  title      text not null,
  body       text not null default '',
  url        text not null default '/alerts',
  category   text,                                -- reminder|task|order|project|nightly|system…
  tag        text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists "own notifications read" on public.notifications;
create policy "own notifications read"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "own notifications update" on public.notifications;
create policy "own notifications update"
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
